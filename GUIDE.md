# Steward Guide

## Vision

Steward turns plain-language local file tasks into verified commands, then saves every green run as a permanent one-click recipe that re-runs with zero model calls. Tagline: **your computer already knows how.**

## Locked decisions

- Bun + TypeScript server; Svelte CSR UI begins only in Phase 3.
- macOS on Apple Silicon and Intel; handle `/opt/homebrew` and `/usr/local` explicitly.
- Curated tools only: ffmpeg, ffprobe, pandoc, imagemagick, ocrmypdf, whisper.cpp, ghostscript, brew.
- The agent plans only; `server/executor.ts` will be the sole shell boundary.
- Bind localhost only; every request requires a random per-session token.
- Verification returns evidence (`name`, `pass`, `expected`, `actual`), never bare booleans.
- Recipes save only after all checks pass; re-runs never import the agent.
- No Phase 3 UI or Phase 4 scope before its phase specification.

## Current phase + step

Phase 1 — Step 1 complete: typed system probe proven on the development Mac. Await approval before Step 2 (Codex CLI planning bridge).

## Decisions

- Keep modules near 150 lines so responsibilities and security boundaries stay reviewable.
- Ignore `ggml-*.bin` because Whisper models are GB-scale install artifacts, not source.
- Probe commands are fixed diagnostic argv arrays; no user input reaches them.
- Keep binary `bun.lockb` via `bunfig.toml` because the build spec explicitly requires it.
- Skip dependency declaration checking because Bun 1.2.8 types conflict with resolved Node declarations; Steward code remains strict-checked.

## Landmines

- Homebrew default prefix differs by architecture: Apple Silicon `/opt/homebrew`, Intel `/usr/local`.
- `whisper-cli --version` is unsupported; read its installed Homebrew formula version instead.
- A missing Whisper model must become a visible install step, never a silent wait.
- Any input-to-command path must use argv arrays, allowlisted binaries, validated paths, streaming, and a 30-minute timeout.
