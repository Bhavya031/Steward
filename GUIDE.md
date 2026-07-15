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

Phase 1 — Step 0 complete: repository baseline. Next: Step 1 system probe.

## Decisions

- Keep modules near 150 lines so responsibilities and security boundaries stay reviewable.
- Ignore `ggml-*.bin` because Whisper models are GB-scale install artifacts, not source.

## Landmines

- Homebrew default prefix differs by architecture: Apple Silicon `/opt/homebrew`, Intel `/usr/local`.
- A missing Whisper model must become a visible install step, never a silent wait.
- Any input-to-command path must use argv arrays, allowlisted binaries, validated paths, streaming, and a 30-minute timeout.

