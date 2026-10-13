use serde::Serialize;
use std::path::Path;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

const WHISPER_RATE: u32 = 16_000;

#[derive(Debug, thiserror::Error)]
pub enum TranscribeError {
    #[error("{0}")]
    Engine(#[from] audio_engine::EngineError),
    #[error("whisper: {0}")]
    Whisper(#[from] whisper_rs::WhisperError),
    #[error("model not found at {0}")]
    MissingModel(String),
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribedWord {
    pub start_sec: f64,
    pub end_sec: f64,
    pub text: String,
    pub confidence: f32,
}

// One whisper segment; with max_len=1 and split_on_word each is a single word or punctuation mark.
#[derive(Debug, Clone)]
pub struct RawSegment {
    pub start_cs: i64,
    pub end_cs: i64,
    pub text: String,
    pub probability: f32,
}

pub fn resample_linear(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || input.is_empty() {
        return input.to_vec();
    }
    let out_len = (input.len() as u64 * to as u64 / from as u64) as usize;
    let ratio = from as f64 / to as f64;
    (0..out_len)
        .map(|i| {
            let pos = i as f64 * ratio;
            let idx = pos.floor() as usize;
            let frac = (pos - idx as f64) as f32;
            let a = input[idx.min(input.len() - 1)];
            let b = input[(idx + 1).min(input.len() - 1)];
            a + (b - a) * frac
        })
        .collect()
}

fn is_annotation(text: &str) -> bool {
    (text.starts_with('[') && text.ends_with(']')) || (text.starts_with('(') && text.ends_with(')'))
}

fn is_punctuation(text: &str) -> bool {
    text.chars().all(|c| c.is_ascii_punctuation() || "…—–".contains(c))
}

pub fn words_from_segments(segments: &[RawSegment]) -> Vec<TranscribedWord> {
    let mut words: Vec<TranscribedWord> = Vec::new();
    for segment in segments {
        let text = segment.text.trim();
        if text.is_empty() || is_annotation(text) {
            continue;
        }
        let start_sec = segment.start_cs as f64 / 100.0;
        let end_sec = segment.end_cs as f64 / 100.0;
        if is_punctuation(text) {
            if let Some(last) = words.last_mut() {
                last.text.push_str(text);
                last.end_sec = last.end_sec.max(end_sec);
            }
            continue;
        }
        words.push(TranscribedWord { start_sec, end_sec, text: text.to_string(), confidence: segment.probability });
    }
    words
}

pub struct TranscribeOptions {
    pub language: Option<String>,
    pub threads: i32,
}

impl Default for TranscribeOptions {
    fn default() -> Self {
        let threads = std::thread::available_parallelism().map(|n| n.get() as i32).unwrap_or(4).min(8);
        Self { language: Some("en".into()), threads }
    }
}

// Transcribes a WAV file to words with source-relative times. `progress` gets 0-100.
pub fn transcribe_file(
    model: &Path,
    wav: &Path,
    options: &TranscribeOptions,
    progress: impl FnMut(i32) + 'static,
) -> Result<Vec<TranscribedWord>, TranscribeError> {
    if !model.exists() {
        return Err(TranscribeError::MissingModel(model.display().to_string()));
    }
    // Routes whisper.cpp's stderr chatter into the `log` crate, which is silent without a logger.
    whisper_rs::install_logging_hooks();
    let info = audio_engine::probe_wav(wav)?;
    let mono = audio_engine::read_wav_mono(wav)?;
    let pcm = resample_linear(&mono, info.sample_rate, WHISPER_RATE);

    let context = WhisperContext::new_with_params(model, WhisperContextParameters::default())?;
    let mut state = context.create_state()?;
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_n_threads(options.threads);
    params.set_language(options.language.as_deref());
    params.set_token_timestamps(true);
    params.set_split_on_word(true);
    params.set_max_len(1);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_special(false);
    params.set_print_timestamps(false);
    params.set_progress_callback_safe(progress);
    state.full(params, &pcm)?;

    let mut segments = Vec::new();
    for segment in state.as_iter() {
        let n = segment.n_tokens();
        let probs: Vec<f32> = (0..n)
            .filter_map(|i| segment.get_token(i))
            .filter(|t| !t.to_str_lossy().map(|s| s.starts_with("[_")).unwrap_or(true))
            .map(|t| t.token_probability())
            .collect();
        let probability = if probs.is_empty() { 0.0 } else { probs.iter().sum::<f32>() / probs.len() as f32 };
        segments.push(RawSegment {
            start_cs: segment.start_timestamp(),
            end_cs: segment.end_timestamp(),
            text: segment.to_str_lossy()?.into_owned(),
            probability,
        });
    }
    Ok(words_from_segments(&segments))
}
