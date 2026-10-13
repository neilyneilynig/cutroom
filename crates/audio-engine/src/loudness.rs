use crate::EngineError;
use ebur128::{EbuR128, Mode};
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Loudness {
    pub integrated_lufs: f64,
    pub true_peak_dbtp: f64,
}

pub fn measure_loudness(interleaved: &[f32], channels: u16, sample_rate: u32) -> Result<Loudness, EngineError> {
    let mut meter = EbuR128::new(channels as u32, sample_rate, Mode::I | Mode::TRUE_PEAK)?;
    meter.add_frames_f32(interleaved)?;
    let mut peak = 0f64;
    for channel in 0..channels as u32 {
        peak = peak.max(meter.true_peak(channel)?);
    }
    Ok(Loudness { integrated_lufs: meter.loudness_global()?, true_peak_dbtp: 20.0 * peak.log10() })
}

// Gain that brings integrated loudness to `target_lufs` without pushing true peak above `ceiling_dbtp`.
pub fn normalize_gain_db(loudness: &Loudness, target_lufs: f64, ceiling_dbtp: f64) -> f64 {
    if !loudness.integrated_lufs.is_finite() {
        return 0.0;
    }
    let to_target = target_lufs - loudness.integrated_lufs;
    let to_ceiling = ceiling_dbtp - loudness.true_peak_dbtp;
    to_target.min(to_ceiling)
}
