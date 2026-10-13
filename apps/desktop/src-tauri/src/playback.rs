use rodio::buffer::SamplesBuffer;
use rodio::{OutputStream, Sink};
use std::sync::mpsc::{channel, Sender};
use std::thread;

enum Command {
    Play { channels: u16, sample_rate: u32, samples: Vec<f32> },
    Stop,
}

// rodio's OutputStream is not Send, so it lives on its own thread for the app's lifetime.
pub struct Player {
    tx: Sender<Command>,
}

impl Player {
    pub fn spawn() -> Self {
        let (tx, rx) = channel::<Command>();
        thread::spawn(move || {
            let Ok((_stream, handle)) = OutputStream::try_default() else {
                eprintln!("cutroom: no audio output device; playback disabled");
                return;
            };
            let mut sink: Option<Sink> = None;
            for command in rx {
                if let Some(old) = sink.take() {
                    old.stop();
                }
                if let Command::Play { channels, sample_rate, samples } = command {
                    if let Ok(new_sink) = Sink::try_new(&handle) {
                        new_sink.append(SamplesBuffer::new(channels, sample_rate, samples));
                        sink = Some(new_sink);
                    }
                }
            }
        });
        Self { tx }
    }

    pub fn play(&self, channels: u16, sample_rate: u32, samples: Vec<f32>) -> Result<(), String> {
        self.tx
            .send(Command::Play { channels, sample_rate, samples })
            .map_err(|_| "audio output unavailable".to_string())
    }

    pub fn stop(&self) {
        let _ = self.tx.send(Command::Stop);
    }
}
