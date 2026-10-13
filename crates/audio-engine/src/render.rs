use crate::session::{Clip, Project};
use crate::wav::{read_wav, write_pcm16};
use crate::EngineError;
use std::collections::HashMap;
use std::path::Path;

const OUT_CHANNELS: usize = 2;

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

pub fn render_wav(project: &Project, dest: &Path) -> Result<(), EngineError> {
    let dest_abs = std::path::absolute(dest)?;
    for file in &project.files {
        if std::path::absolute(&file.path)? == dest_abs {
            return Err(EngineError::WouldOverwriteSource(file.path.clone()));
        }
    }
    let mix = render_mix(project)?;
    write_pcm16(dest, project.sample_rate, OUT_CHANNELS as u16, &mix)
}
