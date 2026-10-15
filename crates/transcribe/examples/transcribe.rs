// cargo run -p transcribe --release --example transcribe -- <model.bin> <file.wav>
use std::path::Path;
use transcribe::{transcribe_file, TranscribeOptions};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let [_, model, wav] = args.as_slice() else {
        eprintln!("usage: transcribe <model.bin> <file.wav>");
        std::process::exit(2);
    };
    let words = transcribe_file(Path::new(model), Path::new(wav), &TranscribeOptions::default(), |_| {})
        .unwrap_or_else(|e| panic!("{e}"));
    for w in words {
        println!("{:7.2} {:7.2} {:4.0}% {}", w.start_sec, w.end_sec, w.confidence * 100.0, w.text);
    }
}
