# Security audit

Last updated: Phase 2 Step 9.5 (2026-07-15). `server/` is currently a CLI; there is no HTTP/WS listener or session-token surface until Phase 3.

## Current execution surface

- Fresh tasks: task/files → model plan → strict plan/profile validation → positive per-tool flag classification → role-based real-path confinement → executor.
- Recipe reruns: validated recipe → local slot rendering → the same executor and verifier. The resolved source graph excludes the agent and any Codex/model reference.
- Verification: fixed ffprobe/ffmpeg/Ghostscript command builders route through the executor; verification never executes plan-supplied argv.
- Helpers: exact helper tier and granted roots; helpers cannot be primary recipe tools or install steps.
- Writes: task outputs beside inputs or in an executor-managed temp root; recipes use atomic temp+rename; failed outputs and normal temp directories are removed.
- Listener: none. Phase 3 must add `127.0.0.1`, random port, and per-session token checks before any request handling.

## Closed critical findings

| Severity | Finding | Resolution |
| --- | --- | --- |
| Critical | Model-controlled `output_path` could target arbitrary writable locations. | Output and parent are resolved after symlinks and confined to input/temp roots; existing and dangling output symlinks fail closed. |
| Critical | Allowlisted binaries accepted dangerous model-controlled flags and embedded file sources. | Every token is positively classified per tool; path roles are validated; GS pipe/unsafe mode, ffmpeg lavfi/movie sources, and pandoc execution hooks are explicitly denied. |
| High | Failed outputs blocked retries and could be mistaken for successful artifacts. | Recipe non-green exits and terminal repair failure remove regular-file outputs without touching inputs. |
| High | Basename-only module graph could hide an agent import behind `index.ts` collisions. | Tests use canonical repo-relative paths, scan reachability hazards, and independently bundle the rerun entry. |

## Deferred to Day 5 audit

| Severity | Item | Risk and required audit action |
| --- | --- | --- |
| High | PATH trust | Probe-discovered binary paths can inherit a poisoned launch environment. Pin/validate trusted Homebrew and system roots, ownership, permissions, and real paths before execution. |
| High | Path TOCTOU | Inputs/parents are checked before a later tool open; a local actor could swap them between validation and execution. Revalidate immediately before spawn and assess descriptor-based or immutable-directory mitigation. |
| Medium | Temp sweep | Normal cleanup works, but process death can strand `steward-run-*` and isolated LibreOffice profiles. Add an owner/mode/age-checked startup sweep. |
| Medium | Architecture enforcement | Recipes record architecture but rerun does not yet enforce compatibility. Mark recipes portable or reject/rebuild architecture-specific commands on mismatch. |
