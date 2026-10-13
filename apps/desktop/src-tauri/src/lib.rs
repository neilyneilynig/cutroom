mod playback;

use audio_engine::{peaks_minmax, read_wav, render_mix, render_wav, Project};
use playback::Player;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

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

#[tauri::command]
async fn export_wav(project: Project, dest: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || render_wav(&project, &PathBuf::from(dest)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
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
        .invoke_handler(tauri::generate_handler![import_wav, export_wav, play, stop])
        .run(tauri::generate_context!())
        .expect("error while running Cutroom");
}
