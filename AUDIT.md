# Security audit

Last updated: Phase 3 entry-state pre-approval audit (2026-07-17). The Phase 2 CLI remains available; the new entry composition is visual-only and adds no enabled input-to-command route.

## Current execution surface

- Fresh tasks: task text reaches the model prompt only, never argv. Model plans pass exact-shape/profile validation, canonical-name and semantic-check validation, closed derivation/intermediate validation, positive per-tool flag classification, and role-based real-path confinement before the executor sees argv.
- Repairs: evidence contains the authored plan, failed expected/actual values, and bounded stderr only. Revised plans repeat the full validation path and must preserve the canonical name plus every check and target.
- Recipe reruns: validated recipe → local path slots + serialized named derivations → the same executor and verifier. The resolved source graph excludes the agent and any Codex/model reference.
- Derivations: non-path slots require a serialized model-selected name and typed args. The sole function uses duration from a fixed executor-routed ffprobe command; there is no eval, expression language, hidden algorithm choice, or baked per-file measurement.
- Verification: fixed ffprobe/ffmpeg/Ghostscript command builders route through the executor; verification never executes plan-supplied argv.
- Helpers: exact helper tier and granted roots; helpers cannot be primary recipe tools or install steps.
- Writes: final task outputs stay beside inputs; ordinary intermediate outputs require exact model declarations that are resolved/revalidated only inside the executor-owned temp root. Reads require an earlier declared write. Recipes use atomic temp+rename; failed outputs and every temp root are removed.
- Shelf claims: canonical names are model-authored but task-slug echoes fail closed. Replacement service/prices come only from the curated `(tool, check type)` map; unknown classes omit both fields, and kill totals deduplicate service names.
- Listener: Bun binds `127.0.0.1` on a random free port. A 256-bit per-session token is required by query or HttpOnly SameSite cookie for every static request and by query for `/ws`; missing/wrong tokens return 401 before routing. Static real paths remain inside `ui/dist`.
- WS bridge: client JSON is capped at 64 KiB and must exactly match `run_task` or `run_recipe`; file grants are absolute, readable regular files. One run per socket prevents overlapping mutations. Task runs match locally before importing the planner; recipe matches emit and retain `model_calls: 0` through completion.
- Browser client: one module-scoped WebSocket takes the per-session token from the startup URL and connects only to same-origin `/ws`. Registered server events flow through one exhaustive store reducer; client-side typing is convenience only, while the server parser remains the command-boundary enforcement.
- Entry surface: poster art is bundled under authenticated static serving. Its textarea, add control, run control, and example chips have no handlers and emit no WS event; P3.6 must audit and test that new route before enabling it. The art disappears when `run_started` moves the store out of idle.
- Operational panels: ActivityStream and VerifyPanel accept store props only. Svelte text interpolation escapes command/evidence strings; no raw HTML or component path reaches execution. Pending rows show no invented evidence; expected/actual appear only when measured results arrive.
- Browser launch: startup may invoke fixed `/usr/bin/open` with only the generated loopback URL. It accepts no task/model input and is outside the recipe module graph; tests disable it.

## Input-to-command trace

| Untrusted source | Route | Enforcement before spawn |
| --- | --- | --- |
| CLI task text | `index` → agent prompt | Treated as quoted data; never interpolated into argv. |
| CLI file paths | `filesFrom` → plan grants | Resolve + readable regular-file check; every later path is role-classified, real-path confined, and checked against the exact grant. |
| WS task/name/files | typed parser → WS engine bridge | Exact event keys/types, bounded strings/files, one active run/socket, absolute readable grants; then the identical match/plan/rerun paths below. |
| Browser client event | singleton `ws.ts` → authenticated `/ws` | TypeScript narrows UI callers; security does not trust it. The server re-parses exact runtime keys/types and reapplies every file/plan policy. |
| Idle entry controls | no route | Visual-only in this step: no handlers, file reads, or WS messages. P3.6 must add and audit the route before controls become active. |
| Model plan or repair | plan → repair loop → executor | Strict keys/types, one primary tool, argv arrays only, semantic check targets, canonical name, declared slots/intermediates, per-tool flags, output confinement, timeout. |
| Saved recipe JSON | load → slot render → executor | Strict recipe validation; only path slots and serialized derivations; rendered plan is revalidated; no agent-reachable module. |
| Derivation input | first granted file → ffprobe duration | Fixed ffprobe argv through executor, closed named formula, typed model-authored args. |
| Verification target | dispatcher → fixed verifier builder | Registered types and semantic targets only; verifier argv is fixed and executor-routed. |

## File writes and listeners

| Surface | Policy |
| --- | --- |
| Final output | One declared output, confined beside the input; existing outputs and output symlinks fail closed. |
| Ordinary intermediates | Declared direct children of one per-run Steward temp root; write-before-read enforced; root removed on pass/fail. |
| Executor artifacts | ffmpeg passlogs/null sinks and isolated LibreOffice profiles stay in executor-owned temp roots and are cleaned. |
| Recipe JSON | Green runs only; atomic exclusive temp write + rename under `recipes/`. |
| Failed output cleanup | Regular files only, never inputs or symlinks; invoked after failed reruns and terminal repair exhaustion. |
| Network listener | Loopback only, random port, per-session token before static routing or WS upgrade; no routes beyond static files and `/ws`; typed WS messages are size/shape bounded and serialized server events carry run IDs. |

## Closed critical findings

| Severity | Finding | Resolution |
| --- | --- | --- |
| Critical | Model-controlled `output_path` could target arbitrary writable locations. | Output and parent are resolved after symlinks and confined to input/temp roots; existing and dangling output symlinks fail closed. |
| Critical | Allowlisted binaries accepted dangerous model-controlled flags and embedded file sources. | Every token is positively classified per tool; path roles are validated; GS pipe/unsafe mode, ffmpeg lavfi/movie sources, and pandoc execution hooks are explicitly denied. |
| High | Failed outputs blocked retries and could be mistaken for successful artifacts. | Recipe non-green exits and terminal repair failure remove regular-file outputs without touching inputs. |
| High | Basename-only module graph could hide an agent import behind `index.ts` collisions. | Tests use canonical repo-relative paths, scan reachability hazards, and independently bundle the rerun entry. |
| High | A legitimate repair could not write an ordinary intermediate, while widening temp access risked restoring arbitrary writes. | Plans/recipes may serialize exact direct-child temp intermediates; undeclared, escaping, input-directory, and read-before-write paths fail closed; cleanup is tested on success and failure. |
| High | Generic runtime slots could hide code-invented behavior or bake measurements from one input into every rerun. | Every non-path slot requires a serialized model-declared named derivation with closed typed args; unknown/unused derivations and baked loudnorm measurements fail closed. |
| High | Type-correct but meaningless check targets could create false evidence or make repair futile (`file_valid: true`, DOCX text extraction). | Check targets and cross-check compatibility are validated before execution and again when loading recipes; invalid plans use the existing defensive re-ask. |
| Medium | Model/task wording and guessed SaaS prices could make shelf claims misleading. | Canonical names reject task-slug echoes; service/price claims are code-curated, unknown classes render no claim, and shared services count once. |
| High | A localhost UI listener could expose execution controls to DNS rebinding/CSRF or serve files outside its build root. | Loopback/random-port binding plus a 256-bit token gates every HTTP/WS request; static paths are decoded, confined, and realpath-checked after symlinks. |

## Deferred to Day 5 audit

| Severity | Item | Risk and required audit action |
| --- | --- | --- |
| High | PATH trust | Probe-discovered binary paths can inherit a poisoned launch environment. Pin/validate trusted Homebrew and system roots, ownership, permissions, and real paths before execution. |
| High | Path TOCTOU | Inputs/parents are checked before a later tool open; a local actor could swap them between validation and execution. Revalidate immediately before spawn and assess descriptor-based or immutable-directory mitigation. |
| Medium | Temp sweep | Normal cleanup works, but process death can strand `steward-run-*` and isolated LibreOffice profiles. Add an owner/mode/age-checked startup sweep. |
| Medium | Architecture enforcement | Recipes record architecture but rerun does not yet enforce compatibility. Mark recipes portable or reject/rebuild architecture-specific commands on mismatch. |
