use audio_engine::{
    peaks_minmax, probe_wav, read_wav_mono, render_wav, write_test_sine, Clip, EngineError,
    MediaFile, Project, Track,
};
use std::path::PathBuf;

fn tmp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("cutroom-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir.join(name)
}

fn track(id: &str) -> Track {
    Track { id: id.into(), name: id.into(), kind: "dialogue".into(), order: 0, mute: false, solo: false }
}

fn clip(id: &str, track: &str, file: &str, s_in: f64, s_out: f64, t: f64) -> Clip {
    Clip {
        id: id.into(),
        track_id: track.into(),
        file_id: file.into(),
        source_in_sec: s_in,
        source_out_sec: s_out,
        timeline_start_sec: t,
        gain_db: 0.0,
        fade_in_sec: 0.0,
        fade_out_sec: 0.0,
    }
}

fn one_file_project(path: &PathBuf, sr: u32, secs: f64, clips: Vec<Clip>) -> Project {
    Project {
        id: "p".into(),
        sample_rate: sr,
        files: vec![MediaFile {
            id: "f1".into(),
            path: path.to_string_lossy().into(),
            duration_sec: secs,
            channel_count: 1,
            sample_rate: sr,
        }],
        tracks: vec![track("t1")],
        clips,
    }
}

#[test]
fn sine_peaks_are_nonempty_and_bounded() {
    let path = tmp("sine.wav");
    write_test_sine(&path, 1.0, 8000).unwrap();
    let pcm = read_wav_mono(&path).unwrap();
    assert_eq!(pcm.len(), 8000);
    let peaks = peaks_minmax(&pcm, 100);
    assert_eq!(peaks.len(), 80);
    assert!(peaks.iter().all(|(lo, hi)| *lo >= -1.0 && *hi <= 1.0 && lo <= hi));
    assert!(peaks[0].1 > 0.3);
}

#[test]
fn identity_render_has_sr_frames() {
    let src = tmp("id-src.wav");
    let dest = tmp("id-out.wav");
    write_test_sine(&src, 1.0, 8000).unwrap();
    let project = one_file_project(&src, 8000, 1.0, vec![clip("c1", "t1", "f1", 0.0, 1.0, 0.0)]);
    render_wav(&project, &dest).unwrap();
    let info = probe_wav(&dest).unwrap();
    assert_eq!(info.frames, 8000);
    assert_eq!(info.sample_rate, 8000);
}

#[test]
fn cut_render_is_shorter() {
    let src = tmp("cut-src.wav");
    let dest = tmp("cut-out.wav");
    write_test_sine(&src, 1.0, 8000).unwrap();
    let project = one_file_project(
        &src,
        8000,
        1.0,
        vec![clip("a", "t1", "f1", 0.0, 0.25, 0.0), clip("b", "t1", "f1", 0.75, 1.0, 0.25)],
    );
    render_wav(&project, &dest).unwrap();
    assert_eq!(probe_wav(&dest).unwrap().frames, 4000);
}

#[test]
fn fade_in_starts_silent_and_muted_track_is_silent() {
    let src = tmp("fade-src.wav");
    let dest = tmp("fade-out.wav");
    write_test_sine(&src, 1.0, 8000).unwrap();
    let mut c = clip("c1", "t1", "f1", 0.0, 1.0, 0.0);
    c.fade_in_sec = 0.5;
    let project = one_file_project(&src, 8000, 1.0, vec![c]);
    render_wav(&project, &dest).unwrap();
    let out = read_wav_mono(&dest).unwrap();
    let early = out[..200].iter().fold(0f32, |m, s| m.max(s.abs()));
    let late = out[6000..].iter().fold(0f32, |m, s| m.max(s.abs()));
    assert!(early < 0.05, "early {early}");
    assert!(late > 0.4, "late {late}");

    let mut muted = project.clone();
    muted.tracks[0].mute = true;
    render_wav(&muted, &dest).unwrap();
    assert!(read_wav_mono(&dest).unwrap().iter().all(|s| *s == 0.0));
}

#[test]
fn oversized_fades_are_clamped_not_panicking() {
    let src = tmp("clamp-src.wav");
    let dest = tmp("clamp-out.wav");
    write_test_sine(&src, 1.0, 8000).unwrap();
    let mut c = clip("c1", "t1", "f1", 0.0, 1.0, 0.0);
    c.fade_in_sec = 5.0;
    c.fade_out_sec = 5.0;
    render_wav(&one_file_project(&src, 8000, 1.0, vec![c]), &dest).unwrap();
}

#[test]
fn sample_rate_mismatch_fails() {
    let src = tmp("sr-src.wav");
    let dest = tmp("sr-out.wav");
    write_test_sine(&src, 1.0, 8000).unwrap();
    let project = one_file_project(&src, 48000, 1.0, vec![clip("c1", "t1", "f1", 0.0, 1.0, 0.0)]);
    match render_wav(&project, &dest) {
        Err(EngineError::SampleRateMismatch { expected: 48000, found: 8000 }) => {}
        other => panic!("expected mismatch, got {other:?}"),
    }
}

#[test]
fn render_refuses_to_overwrite_source() {
    let src = tmp("ow-src.wav");
    write_test_sine(&src, 1.0, 8000).unwrap();
    let project = one_file_project(&src, 8000, 1.0, vec![clip("c1", "t1", "f1", 0.0, 1.0, 0.0)]);
    assert!(matches!(render_wav(&project, &src), Err(EngineError::WouldOverwriteSource(_))));
}

#[test]
fn project_parses_from_session_model_json() {
    let json = r#"{"id":"p","sampleRate":48000,"files":[],"tracks":[],"clips":[
      {"id":"c","trackId":"t","fileId":"f","sourceInSec":0,"sourceOutSec":1,"timelineStartSec":0,
       "gainDb":0,"fadeInSec":0,"fadeOutSec":0}],"words":[],"markers":[]}"#;
    let p: Project = serde_json::from_str(json).unwrap();
    assert_eq!(p.clips[0].source_out_sec, 1.0);
}
