# Steward Guide

Vision: Verified local work → model-free recipes.

Locked: Bun/TS, macOS arm64/x64, Svelte P3. Tools: `ffmpeg ffprobe pandoc magick ocrmypdf whisper-cli gs soffice brew`; helpers: `ls cat mkdir cp mv stat du head tail` (steps only). Additions need approval. Localhost+token; evidence; green-only.

Now: P1 complete: plan/execute/verify/save; fuzzy zero-model rerun. Next P2 repair.

Rules: ≤150 lines; heavy=yes; `gpt-5.6-sol`; executor owns spawns; recipes exclude agent.

Risks: Brew `/opt/homebrew` arm64, `/usr/local` x64; isolate `soffice`.
