# Cutroom

Local-first podcast post-production for professional editors.

Desktop owns the cut. Media stays on disk. Cloud (later) holds review mixes only.

```bash
pnpm install
pnpm test            # session-model + desktop editor (Vitest) and audio-engine (cargo)
pnpm desktop:dev     # launch the Tauri app
```

## Desktop spike (v1)

- **Add audio** — up to 4 WAV files (one per mic, plus music). The first file locks the sample rate; a mismatched file is rejected, never resampled.
- **Drag** across the timeline to select a range, **Delete** to ripple-cut it from every track (linked ripple).
- **Space** play/stop · **Ctrl+Z / Ctrl+Shift+Z** undo/redo · **Ctrl+wheel** or **+/-** zoom · **0** fit · **M/S** per-track mute/solo.
- **Export WAV** renders the edit list to a new 16-bit stereo file. Originals are never written; exporting over a source file is refused.

Layout: `packages/session-model` (EDL, transcript mapping), `crates/audio-engine` (WAV decode, peaks, mixdown), `apps/desktop` (Tauri 2 + React).

See [docs/specs/2026-10-12-session-model.md](docs/specs/2026-10-12-session-model.md).
