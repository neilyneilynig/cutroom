# Cutroom

Local-first podcast post-production for professional editors.

Desktop owns the cut. Media stays on disk. Cloud (later) holds review mixes only.

```bash
pnpm install         # building whisper.cpp needs cmake and a C++ compiler
pnpm test            # Vitest (session-model, desktop) + cargo (audio-engine, transcribe)
# real whisper run: CUTROOM_WHISPER_MODEL=/path/ggml-base.en.bin cargo test -p transcribe -- --ignored
pnpm desktop:dev     # launch the Tauri app
```

## Desktop editor

- **Add audio** (Ctrl+I) — up to 4 WAV files (one per mic, plus music). The first file locks the sample rate; a mismatched file is rejected, never resampled.
- **Transcribe** — on-device whisper.cpp. The first time, click *Choose Whisper model…* and pick a ggml model such as `ggml-base.en.bin` (download from huggingface.co/ggerganov/whisper.cpp); Cutroom keeps a copy. `CUTROOM_WHISPER_MODEL=/path/model.bin` also works.
- **Edit by text** — click a word to jump there, drag or shift-click to select, **Delete** cuts that range from every track. Low-confidence words have a dotted underline.
- **Edit on the timeline** — drag to select a range, **Delete** to ripple-cut; click a clip to set gain and fades or **Ctrl+B** to split at the playhead.
- **Space** play/stop · **Ctrl+Z / Ctrl+Shift+Z** undo/redo · **Ctrl+wheel** or **+/-** zoom · **0** fit · **M/S** mute/solo.
- **Save / Open** (Ctrl+S / Ctrl+O) — `.cutroom` project files store the edit list and transcript; media stays where it is.
- **Export** (Ctrl+E) — WAV master or MP3 (192/128 kbps, needs `ffmpeg` on PATH), optionally normalized to −16 LUFS with true peak ≤ −1 dBTP. Originals are never written.

Layout: `packages/session-model` (EDL, transcript mapping), `crates/audio-engine` (WAV decode, peaks, mixdown, loudness, export), `crates/transcribe` (whisper.cpp), `apps/desktop` (Tauri 2 + React).

See [docs/specs/2026-10-12-session-model.md](docs/specs/2026-10-12-session-model.md).
