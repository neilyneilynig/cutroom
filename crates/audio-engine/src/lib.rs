mod peaks;
mod render;
mod session;
mod wav;

pub use peaks::peaks_minmax;
pub use render::{render_mix, render_wav};
pub use session::{Clip, MediaFile, Project, Track};
pub use wav::{probe_wav, read_wav, read_wav_mono, write_pcm16, write_test_sine, WavInfo};

#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error("wav: {0}")]
    Wav(#[from] hound::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("sample rate mismatch: project is {expected} Hz, file is {found} Hz")]
    SampleRateMismatch { expected: u32, found: u32 },
    #[error("clip references unknown file {0}")]
    MissingFile(String),
    #[error("refusing to overwrite source media {0}")]
    WouldOverwriteSource(String),
}
