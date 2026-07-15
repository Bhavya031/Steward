# Steward Guide

Vision: Verified run → model-free recipe. **Your computer already knows how.**

Locked: Bun/TS; macOS arm64/x64; Svelte P3. Final tools: `ffmpeg ffprobe pandoc magick ocrmypdf whisper-cli gs soffice brew`. Helpers (steps only): `ls cat mkdir cp mv stat du head tail`; never recipes/install. No additions without approval. Localhost+token; evidence; green-only.

Now: P1 S4 done; next S5 recipes.

Rules: ≤150 lines/module; heavy install needs yes. Planner: read-only `gpt-5.6-sol`, strict/retry. Executor owns argv/spawns/grants; 30m, streams, fixed helper/probe modes.

Risks: Brew `/opt/homebrew` arm64, `/usr/local` x64; Whisper via Brew; isolate `soffice`.
