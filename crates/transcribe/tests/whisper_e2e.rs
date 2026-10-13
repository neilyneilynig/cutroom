// Needs a ggml model: CUTROOM_WHISPER_MODEL=/path/ggml-base.en.bin cargo test -p transcribe -- --ignored
use std::path::PathBuf;
use std::process::Command;
use transcribe::{transcribe_file, TranscribeOptions};

#[test]
#[ignore]
fn transcribes_synthesized_speech() {
    let model = PathBuf::from(std::env::var("CUTROOM_WHISPER_MODEL").expect("set CUTROOM_WHISPER_MODEL"));
    let wav = std::env::temp_dir().join(format!("cutroom-speech-{}.wav", std::process::id()));
    let status = Command::new("espeak-ng")
        .args(["-s", "140", "-w"])
        .arg(&wav)
        .arg("Welcome back to the show. Today we are talking about coffee.")
        .status()
        .expect("espeak-ng");
    assert!(status.success());
    let words = transcribe_file(&model, &wav, &TranscribeOptions::default(), |_| {}).unwrap();
    let text = words.iter().map(|w| w.text.to_lowercase()).collect::<Vec<_>>().join(" ");
    assert!(text.contains("coffee"), "{text}");
    assert!(words.windows(2).all(|w| w[0].start_sec <= w[1].start_sec));
    let coffee = words.iter().find(|w| w.text.to_lowercase().contains("coffee")).unwrap();
    assert!(coffee.start_sec > 1.5, "{coffee:?}");
}
