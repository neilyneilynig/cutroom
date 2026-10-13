# Cutroom

Local-first podcast post-production for professional editors.

Desktop owns the cut. Media stays on disk. Cloud (later) holds review mixes only.

```bash
pnpm install
pnpm --filter @cutroom/session-model test
cargo test -p audio-engine
pnpm desktop:dev
```

See [docs/specs/2026-10-12-session-model.md](docs/specs/2026-10-12-session-model.md).
