# Steward Guide

**Vision:** Plain-language task → verified local run → model-free recipe. **Your computer already knows how.**

**Locked:** Bun/TS; macOS arm64/x64; Svelte P3. Primary/install, final: `ffmpeg ffprobe pandoc magick ocrmypdf whisper-cli gs soffice brew`. Helpers, steps only: `ls cat mkdir cp mv stat du head tail`; never recipes/install. Additions need approval. Localhost+token; evidence; green-only saves.

**Now:** P1 Step 3 + helper amendment done; next: Step 4 video verification.

**Policy:** ≤150 lines/module; heavy installs require yes. Read-only `gpt-5.6-sol` planner, strict JSON/retry. Executor: argv, grants, no overwrite/network, 30m, streaming; helpers use fixed paths.

**Landmines:** Brew arm64 `/opt/homebrew`, x64 `/usr/local`; Whisper via Brew; isolate `soffice`; generic GPT alias fails.
