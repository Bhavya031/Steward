# Steward Guide

## Vision

Plain-language file tasks become local, evidence-verified commands, then permanent zero-model recipes. Tagline: **your computer already knows how.**

## Locked

- Bun/TypeScript; Svelte CSR only in Phase 3; macOS arm64/x64.
- Final allowlist: `ffmpeg`, `ffprobe`, `pandoc`, `magick`, `ocrmypdf`, `whisper-cli`, `gs`, `soffice`, `brew`. No additions without explicit approval.
- Agent only fixed-spawns `codex`; executor alone runs validated planned argv.
- Bind `127.0.0.1`; require a random session token.
- Checks return evidence; save only all-green recipes; re-runs never import agent.
- No future-phase work before its spec.

## Now

Phase 1 — Step 2 complete: GPT-5.6 Sol plans through authenticated Codex CLI and strict host validation. Await approval before Step 3 executor.

## Decisions

- Modules ~150 lines; probes use fixed argv (auditability).
- Light installs may be proposed; heavy `soffice`/Whisper needs explicit yes; never silent.
- Planner: ephemeral/read-only `gpt-5.6-sol`, schema, host validation, one retry (untrusted output).
- Binary `bun.lockb`; `skipLibCheck` only isolates Bun/Node declarations.

## Landmines

- Prefixes: arm64 `/opt/homebrew`; Intel `/usr/local`.
- `whisper-cli --version` fails; use Brew’s formula version. Ignore `ggml-*.bin`; missing models stay visible.
- Prefer `/Applications/LibreOffice.app/Contents/MacOS/soffice` over PATH shims.
- CLI 0.144.4 rejects generic `gpt-5.6` with ChatGPT auth; `gpt-5.6-sol` works.
