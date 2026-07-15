# Steward Guide

**Vision:** Natural-language tasks → verified local execution → model-free recipes. **Your computer already knows how.**

**Locked:** Bun/TS, macOS arm64/x64; Svelte Phase 3. Binaries: `ffmpeg ffprobe pandoc magick ocrmypdf whisper-cli gs soffice brew`; additions need approval. `codex` plans; executor runs argv. Localhost+token; evidence; green-only recipes.

**Now:** Phase 1 Step 3 complete (streamed ffmpeg); next: Step 4 video verification.

**Policy:** ≤150-line modules. Heavy installs need explicit yes. Planner: read-only `gpt-5.6-sol`, schema/validation/retry. Executor: probed binaries, exact grants, no overwrite/network, 30-minute cap, streaming.

**Landmines:** Brew: arm64 `/opt/homebrew`, Intel `/usr/local`. Whisper version via Brew. Executor isolates `soffice`. `gpt-5.6-sol` verified; generic alias fails this CLI path.
