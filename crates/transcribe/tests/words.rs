use transcribe::{resample_linear, words_from_segments, RawSegment};

fn seg(t0: i64, t1: i64, text: &str, p: f32) -> RawSegment {
    RawSegment { start_cs: t0, end_cs: t1, text: text.into(), probability: p }
}

#[test]
fn resamples_48k_to_16k_by_length_and_value() {
    let input: Vec<f32> = (0..48000).map(|i| i as f32 / 48000.0).collect();
    let out = resample_linear(&input, 48000, 16000);
    assert_eq!(out.len(), 16000);
    assert!((out[8000] - 0.5).abs() < 1e-3);
}

#[test]
fn resample_is_identity_at_same_rate() {
    let input = vec![0.1, 0.2, 0.3];
    assert_eq!(resample_linear(&input, 16000, 16000), input);
}

#[test]
fn trims_words_and_converts_centiseconds() {
    let words = words_from_segments(&[seg(0, 50, " Hello", 0.9), seg(50, 120, " world", 0.8)]);
    assert_eq!(words.len(), 2);
    assert_eq!(words[0].text, "Hello");
    assert_eq!(words[1].start_sec, 0.5);
    assert_eq!(words[1].end_sec, 1.2);
    assert!((words[1].confidence - 0.8).abs() < 1e-6);
}

#[test]
fn glues_punctuation_onto_the_previous_word() {
    let words = words_from_segments(&[seg(0, 50, " Hello", 0.9), seg(50, 55, ",", 0.5), seg(60, 90, " there", 0.9), seg(90, 92, ".", 0.9)]);
    assert_eq!(words.iter().map(|w| w.text.as_str()).collect::<Vec<_>>(), ["Hello,", "there."]);
    assert_eq!(words[0].end_sec, 0.55);
}

#[test]
fn drops_non_speech_annotations_and_blanks() {
    let words = words_from_segments(&[seg(0, 100, " [BLANK_AUDIO]", 0.9), seg(100, 120, "  ", 0.9), seg(120, 150, " (music)", 0.9), seg(150, 180, " ok", 0.9)]);
    assert_eq!(words.iter().map(|w| w.text.as_str()).collect::<Vec<_>>(), ["ok"]);
}
