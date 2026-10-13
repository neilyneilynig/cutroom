use crate::EngineError;
use hound::{SampleFormat, WavReader, WavSpec, WavWriter};
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WavInfo {
    pub sample_rate: u32,
    pub channels: u16,
    pub frames: u64,
}

impl WavInfo {
    pub fn duration_sec(&self) -> f64 {
        self.frames as f64 / self.sample_rate as f64
    }
}

pub fn probe_wav(path: &Path) -> Result<WavInfo, EngineError> {
    let reader = WavReader::open(path)?;
    let spec = reader.spec();
    Ok(WavInfo {
        sample_rate: spec.sample_rate,
        channels: spec.channels,
        frames: reader.duration() as u64,
    })
}

// Interleaved samples scaled to [-1, 1].
pub fn read_wav(path: &Path) -> Result<(WavInfo, Vec<f32>), EngineError> {
    let info = probe_wav(path)?;
    let mut reader = WavReader::open(path)?;
    let spec = reader.spec();
    let samples = match spec.sample_format {
        SampleFormat::Float => reader.samples::<f32>().collect::<Result<Vec<_>, _>>()?,
        SampleFormat::Int => {
            let scale = 1.0 / (1u64 << (spec.bits_per_sample - 1)) as f32;
            reader
                .samples::<i32>()
                .map(|s| s.map(|v| v as f32 * scale))
                .collect::<Result<Vec<_>, _>>()?
        }
    };
    Ok((info, samples))
}

pub fn read_wav_mono(path: &Path) -> Result<Vec<f32>, EngineError> {
    let (info, samples) = read_wav(path)?;
    let channels = info.channels.max(1) as usize;
    Ok(samples
        .chunks(channels)
        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
        .collect())
}

pub fn write_pcm16(path: &Path, sample_rate: u32, channels: u16, samples: &[f32]) -> Result<(), EngineError> {
    let spec = WavSpec { channels, sample_rate, bits_per_sample: 16, sample_format: SampleFormat::Int };
    let mut writer = WavWriter::create(path, spec)?;
    for &s in samples {
        writer.write_sample((s.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16)?;
    }
    writer.finalize()?;
    Ok(())
}

pub fn write_test_sine(path: &Path, secs: f32, sr: u32) -> Result<(), EngineError> {
    let frames = (secs * sr as f32).round() as usize;
    let samples: Vec<f32> = (0..frames)
        .map(|i| 0.5 * (2.0 * std::f32::consts::PI * 440.0 * i as f32 / sr as f32).sin())
        .collect();
    write_pcm16(path, sr, 1, &samples)
}
