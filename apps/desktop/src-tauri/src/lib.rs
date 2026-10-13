mod playback;

use audio_engine::{measure_loudness, peaks_minmax, read_wav, render_mix, ExportOptions, ExportReport, Loudness, Project};
use playback::Player;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use transcribe::{transcribe_file, TranscribeOptions, TranscribedWord};

const PROJECT_EXTENSION: &str = "cutroom";

// Peak resolution sent to the UI: one min/max pair per 10 ms.
const PEAKS_PER_SEC: u32 = 100;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportedWav {
    path: String,
    sample_rate: u32,
    channel_count: u16,
    duration_sec: f64,
    peaks_per_sec: u32,
    // Flattened [min0, max0, min1, max1, ...] of the mono downmix.
    peaks: Vec<f32>,
}

#[tauri::command]
async fn import_wav(path: String) -> Result<ImportedWav, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (info, samples) = read_wav(&PathBuf::from(&path)).map_err(|e| e.to_string())?;
        let channels = info.channels.max(1) as usize;
        let mono: Vec<f32> = samples
            .chunks(channels)
            .map(|frame| frame.iter().sum::<f32>() / channels as f32)
            .collect();
        let bucket = (info.sample_rate / PEAKS_PER_SEC).max(1) as usize;
        let peaks = peaks_minmax(&mono, bucket).into_iter().flat_map(|(lo, hi)| [lo, hi]).collect();
        Ok(ImportedWav {
            path,
            sample_rate: info.sample_rate,
            channel_count: info.channels,
            duration_sec: info.duration_sec(),
            peaks_per_sec: PEAKS_PER_SEC,
            peaks,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

async fn blocking<T: Send + 'static>(job: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(job).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn export(project: Project, dest: String, options: ExportOptions) -> Result<ExportReport, String> {
    blocking(move || audio_engine::export(&project, &PathBuf::from(dest), &options).map_err(|e| e.to_string())).await
}

#[tauri::command]
async fn measure_mix(project: Project) -> Result<Loudness, String> {
    blocking(move || {
        let mix = render_mix(&project).map_err(|e| e.to_string())?;
        measure_loudness(&mix, 2, project.sample_rate).map_err(|e| e.to_string())
    })
    .await
}

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("models"))
}

// First ggml model in the app's models folder, or CUTROOM_WHISPER_MODEL.
#[tauri::command]
fn find_model(app: AppHandle) -> Result<Option<String>, String> {
    if let Ok(path) = std::env::var("CUTROOM_WHISPER_MODEL") {
        if Path::new(&path).exists() {
            return Ok(Some(path));
        }
    }
    let Ok(entries) = std::fs::read_dir(models_dir(&app)?) else {
        return Ok(None);
    };
    let mut models: Vec<PathBuf> = entries
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|ext| ext == "bin"))
        .collect();
    models.sort();
    Ok(models.first().map(|p| p.to_string_lossy().into_owned()))
}

// Copies a user-chosen ggml model into the app's models folder so it is found next time.
#[tauri::command]
async fn install_model(app: AppHandle, source: String) -> Result<String, String> {
    let dir = models_dir(&app)?;
    blocking(move || {
        let source = PathBuf::from(source);
        if source.extension().is_none_or(|ext| ext != "bin") {
            return Err("Pick a whisper.cpp ggml model (.bin)".into());
        }
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let dest = dir.join(source.file_name().ok_or("bad model path")?);
        std::fs::copy(&source, &dest).map_err(|e| e.to_string())?;
        Ok(dest.to_string_lossy().into_owned())
    })
    .await
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TranscribeProgress {
    track_id: String,
    percent: i32,
}

#[tauri::command]
async fn transcribe(app: AppHandle, model: String, path: String, track_id: String) -> Result<Vec<TranscribedWord>, String> {
    blocking(move || {
        let emitter = app.clone();
        let progress = move |percent: i32| {
            let _ = emitter.emit("transcribe-progress", TranscribeProgress { track_id: track_id.clone(), percent });
        };
        transcribe_file(Path::new(&model), Path::new(&path), &TranscribeOptions::default(), progress)
            .map_err(|e| e.to_string())
    })
    .await
}

fn require_project_extension(path: &str) -> Result<(), String> {
    if Path::new(path).extension().is_some_and(|ext| ext == PROJECT_EXTENSION) {
        Ok(())
    } else {
        Err(format!("Project files must end in .{PROJECT_EXTENSION}"))
    }
}

#[tauri::command]
fn save_project(path: String, contents: String) -> Result<(), String> {
    require_project_extension(&path)?;
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_project(path: String) -> Result<String, String> {
    require_project_extension(&path)?;
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn play(project: Project, from_sec: f64, player: State<'_, Mutex<Player>>) -> Result<(), String> {
    let sample_rate = project.sample_rate;
    let mix = tauri::async_runtime::spawn_blocking(move || render_mix(&project))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    let start = ((from_sec.max(0.0) * sample_rate as f64).round() as usize * 2).min(mix.len());
    player.lock().unwrap().play(2, sample_rate, mix[start..].to_vec())
}

#[tauri::command]
fn stop(player: State<'_, Mutex<Player>>) {
    player.lock().unwrap().stop();
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(Player::spawn()))
        .invoke_handler(tauri::generate_handler![
            import_wav,
            export,
            measure_mix,
            find_model,
            install_model,
            transcribe,
            save_project,
            load_project,
            play,
            stop
        ])
        .run(tauri::generate_context!())
        .expect("error while running Cutroom");
}
