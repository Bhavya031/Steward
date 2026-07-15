# Steward Map

`.gitignore` — Excludes local dependencies, secrets, build output, logs, and large Whisper models. Exports: none.
`bun.lockb` — Committed binary Bun dependency lockfile. Exports: none.
`bunfig.toml` — Keeps Bun on the required committed `bun.lockb` format. Exports: none.
`MAP.md` — One-line repository map for fast session orientation. Exports: none.
`GUIDE.md` — Project brain: vision, locked decisions, current work, decisions, and landmines. Exports: none.
`package.json` — Bun scripts and pinned development tooling. Exports: scripts `probe`, `typecheck`.
`README.md` — Public project overview stub; full collaboration narrative is due at freeze. Exports: none.
`tsconfig.json` — Strict TypeScript checking for the server. Exports: none.
`server/probe.ts` — Builds and prints the typed macOS, hardware, Homebrew, and curated-tool profile. Exports: `CuratedTool`, `ToolStatus`, `BrewStatus`, `SystemProfile`, `probeSystem`.
