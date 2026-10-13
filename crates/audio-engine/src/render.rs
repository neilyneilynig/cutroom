use crate::loudness::{measure_loudness, normalize_gain_db, Loudness};
use crate::session::{Clip, Project};
use crate::wav::{read_wav, write_pcm16};
use crate::EngineError;
use std::collections::HashMap;
use std::path::Path;

const OUT_CHANNELS: usize = 2;
pub const PODCAST_LUFS: f64 = -16.0;
pub const TRUE_PEAK_DBTP: f64 = -1.0;

fn frame(sec: f64, sr: u32) -> i64 {
    (sec * sr as f64).round() as i64
}

fn audible_tracks(project: &Project) -> Vec<&str> {
    let any_solo = project.tracks.iter().any(|t| t.solo);
    project
        .tracks
        .iter()
        .filter(|t| !t.mute && (!any_solo || t.solo))
        .map(|t| t.id.as_str())
        .collect()
}

struct Source {
    channels: usize,
    samples: Vec<f32>,
}

impl Source {
    fn frames(&self) -> i64 {
        (self.samples.len() / self.channels) as i64
    }

    // Stereo frame at index; mono sources go to both sides.
    fn stereo(&self, idx: i64) -> (f32, f32) {
        if idx < 0 || idx >= self.frames() {
            return (0.0, 0.0);
        }
        let base = idx as usize * self.channels;
        let left = self.samples[base];
        let right = if self.channels > 1 { self.samples[base + 1] } else { left };
        (left, right)
    }
}

fn envelope(i: i64, len: i64, fade_in: i64, fade_out: i64) -> f32 {
    let mut gain = 1.0f32;
    if fade_in > 0 && i < fade_in {
        gain *= i as f32 / fade_in as f32;
    }
    if fade_out > 0 && i >= len - fade_out {
        gain *= (len - i) as f32 / fade_out as f32;
    }
    gain
}

fn mix_clip(out: &mut [f32], clip: &Clip, source: &Source, sr: u32) {
    let start = frame(clip.timeline_start_sec, sr);
    let len = frame(clip.timeline_end_sec(), sr) - start;
    let src_start = frame(clip.source_in_sec, sr);
    let (fade_in, fade_out) = clip.clamped_fades();
    let (fade_in, fade_out) = (frame(fade_in, sr), frame(fade_out, sr));
    let gain = 10f32.powf(clip.gain_db as f32 / 20.0);
    for i in 0..len.max(0) {
        let dst = start + i;
        if dst < 0 {
            continue;
        }
        let (l, r) = source.stereo(src_start + i);
        let g = gain * envelope(i, len, fade_in, fade_out);
        let at = dst as usize * OUT_CHANNELS;
        out[at] += l * g;
        out[at + 1] += r * g;
    }
}

// Interleaved stereo mix of the EDL at the project sample rate.
pub fn render_mix(project: &Project) -> Result<Vec<f32>, EngineError> {
    let sr = project.sample_rate;
    let audible = audible_tracks(project);
    let total = project.clips.iter().map(|c| frame(c.timeline_end_sec(), sr)).max().unwrap_or(0).max(0);
    let mut out = vec![0f32; total as usize * OUT_CHANNELS];
    let mut sources: HashMap<&str, Source> = HashMap::new();

    for clip in &project.clips {
        if !audible.contains(&clip.track_id.as_str()) {
            continue;
        }
        if !sources.contains_key(clip.file_id.as_str()) {
            let file = project
                .files
                .iter()
                .find(|f| f.id == clip.file_id)
                .ok_or_else(|| EngineError::MissingFile(clip.file_id.clone()))?;
            let (info, samples) = read_wav(Path::new(&file.path))?;
            if info.sample_rate != sr {
                return Err(EngineError::SampleRateMismatch { expected: sr, found: info.sample_rate });
            }
            sources.insert(&clip.file_id, Source { channels: info.channels.max(1) as usize, samples });
        }
        mix_clip(&mut out, clip, &sources[clip.file_id.as_str()], sr);
    }
    Ok(out)
}

fn refuse_source_overwrite(project: &Project, dest: &Path) -> Result<(), EngineError> {
    let dest_abs = std::path::absolute(dest)?;
    for file in &project.files {
        if std::path::absolute(&file.path)? == dest_abs {
            return Err(EngineError::WouldOverwriteSource(file.path.clone()));
        }
    }
    Ok(())
}

pub fn render_wav(project: &Project, dest: &Path) -> Result<(), EngineError> {
    refuse_source_overwrite(project, dest)?;
    let mix = render_mix(project)?;
    write_pcm16(dest, project.sample_rate, OUT_CHANNELS as u16, &mix)
}

#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ExportFormat {
    Wav,
    Mp3 { kbps: u32 },
}

#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOptions {
    pub format: ExportFormat,
    pub normalize: bool,
}

#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportReport {
    pub before: Loudness,
    pub gain_db: f64,
}

// Renders the EDL, optionally normalizes to the podcast target, and writes WAV or MP3.
pub fn export(project: &Project, dest: &Path, options: &ExportOptions) -> Result<ExportReport, EngineError> {
    refuse_source_overwrite(project, dest)?;
    let mut mix = render_mix(project)?;
    let before = measure_loudness(&mix, OUT_CHANNELS as u16, project.sample_rate)?;
    let gain_db = if options.normalize { normalize_gain_db(&before, PODCAST_LUFS, TRUE_PEAK_DBTP) } else { 0.0 };
    if gain_db != 0.0 {
        let gain = 10f32.powf(gain_db as f32 / 20.0);
        mix.iter_mut().for_each(|s| *s *= gain);
    }
    match options.format {
        ExportFormat::Wav => write_pcm16(dest, project.sample_rate, OUT_CHANNELS as u16, &mix)?,
        ExportFormat::Mp3 { kbps } => {
            let temp = dest.with_extension("mp3.tmp.wav");
            write_pcm16(&temp, project.sample_rate, OUT_CHANNELS as u16, &mix)?;
            let result = encode_mp3(&temp, dest, kbps);
            let _ = std::fs::remove_file(&temp);
            result?;
        }
    }
    Ok(ExportReport { before, gain_db })
}

fn encode_mp3(wav: &Path, dest: &Path, kbps: u32) -> Result<(), EngineError> {
    let output = std::process::Command::new("ffmpeg")
        .args(["-y", "-hide_banner", "-loglevel", "error", "-i"])
        .arg(wav)
        .args(["-codec:a", "libmp3lame", "-b:a", &format!("{kbps}k")])
        .arg(dest)
        .output()
        .map_err(|e| EngineError::Encoder(format!("could not run ffmpeg: {e}")))?;
    if !output.status.success() {
        return Err(EngineError::Encoder(String::from_utf8_lossy(&output.stderr).trim().to_string()));
    }
    Ok(())
}
