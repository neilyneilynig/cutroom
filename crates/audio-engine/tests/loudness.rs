use audio_engine::{
    export, measure_loudness, normalize_gain_db, probe_wav, read_wav, write_pcm16, Clip, ExportFormat,
    ExportOptions, Loudness, MediaFile, Project, Track,
};
use std::path::PathBuf;

fn tmp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("cutroom-loud-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir.join(name)
}

fn stereo_sine(amp: f32, secs: f32, sr: u32) -> Vec<f32> {
    (0..(secs * sr as f32) as usize)
        .flat_map(|i| {
            let s = amp * (2.0 * std::f32::consts::PI * 997.0 * i as f32 / sr as f32).sin();
            [s, s]
        })
        .collect()
}

fn project_for(path: &PathBuf, sr: u32, secs: f64) -> Project {
    Project {
        id: "p".into(),
        sample_rate: sr,
        files: vec![MediaFile { id: "f".into(), path: path.to_string_lossy().into(), duration_sec: secs, channel_count: 2, sample_rate: sr }],
        tracks: vec![Track { id: "t".into(), name: "t".into(), kind: "dialogue".into(), order: 0, mute: false, solo: false }],
        clips: vec![Clip {
            id: "c".into(), track_id: "t".into(), file_id: "f".into(), source_in_sec: 0.0, source_out_sec: secs,
            timeline_start_sec: 0.0, gain_db: 0.0, fade_in_sec: 0.0, fade_out_sec: 0.0,
        }],
    }
}

#[test]
fn measures_a_stereo_sine() {
    let l = measure_loudness(&stereo_sine(0.5, 3.0, 48000), 2, 48000).unwrap();
    assert!((l.integrated_lufs - -6.0).abs() < 1.0, "{l:?}");
    assert!((l.true_peak_dbtp - -6.0).abs() < 0.5, "{l:?}");
}

#[test]
fn silence_measures_as_negative_infinity_and_gets_no_gain() {
    let l = measure_loudness(&vec![0.0; 48000 * 2 * 2], 2, 48000).unwrap();
    assert!(l.integrated_lufs.is_infinite() && l.integrated_lufs < 0.0);
    assert_eq!(normalize_gain_db(&l, -16.0, -1.0), 0.0);
}

#[test]
fn normalize_gain_hits_target_unless_peak_ceiling_limits_it() {
    let quiet = Loudness { integrated_lufs: -22.0, true_peak_dbtp: -10.0 };
    assert!((normalize_gain_db(&quiet, -16.0, -1.0) - 6.0).abs() < 1e-9);
    let hot = Loudness { integrated_lufs: -10.0, true_peak_dbtp: -0.5 };
    assert!((normalize_gain_db(&hot, -16.0, -1.0) - -6.0).abs() < 1e-9);
    let peaky = Loudness { integrated_lufs: -30.0, true_peak_dbtp: -6.0 };
    assert!((normalize_gain_db(&peaky, -16.0, -1.0) - 5.0).abs() < 1e-9);
}

#[test]
fn normalized_wav_export_lands_on_podcast_target() {
    let src = tmp("quiet.wav");
    let dest = tmp("norm.wav");
    write_pcm16(&src, 48000, 2, &stereo_sine(0.05, 4.0, 48000)).unwrap();
    let report = export(&project_for(&src, 48000, 4.0), &dest, &ExportOptions { format: ExportFormat::Wav, normalize: true }).unwrap();
    assert!(report.gain_db > 5.0);
    let (_, samples) = read_wav(&dest).unwrap();
    let l = measure_loudness(&samples, 2, 48000).unwrap();
    assert!((l.integrated_lufs - -16.0).abs() < 0.5, "{l:?}");
    assert!(l.true_peak_dbtp <= -0.9, "{l:?}");
}

#[test]
fn mp3_export_writes_an_mp3() {
    if std::process::Command::new("ffmpeg").arg("-version").output().is_err() {
        eprintln!("skipping: ffmpeg not on PATH");
        return;
    }
    let src = tmp("mp3src.wav");
    let dest = tmp("out.mp3");
    write_pcm16(&src, 48000, 2, &stereo_sine(0.3, 2.0, 48000)).unwrap();
    export(&project_for(&src, 48000, 2.0), &dest, &ExportOptions { format: ExportFormat::Mp3 { kbps: 128 }, normalize: false }).unwrap();
    let bytes = std::fs::read(&dest).unwrap();
    assert!(bytes.len() > 10_000);
    assert!(bytes.starts_with(b"ID3") || (bytes[0] == 0xFF && bytes[1] & 0xE0 == 0xE0));
    assert!(probe_wav(&dest).is_err(), "should not be a wav");
    assert!(!dest.with_extension("mp3.tmp.wav").exists(), "temp file cleaned up");
}
