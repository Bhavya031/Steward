# Security audit

Last updated: Phase 2 Step 12 pre-tag audit (2026-07-16). `server/` is currently a CLI; there is no HTTP/WS listener or session-token surface until Phase 3.

## Current execution surface

- Fresh tasks: task text reaches the model prompt only, never argv. Model plans pass exact-shape/profile validation, canonical-name and semantic-check validation, closed derivation/intermediate validation, positive per-tool flag classification, and role-based real-path confinement before the executor sees argv.
- Repairs: evidence contains the authored plan, failed expected/actual values, and bounded stderr only. Revised plans repeat the full validation path and must preserve the canonical name plus every check and target.
- Recipe reruns: validated recipe → local path slots + serialized named derivations → the same executor and verifier. The resolved source graph excludes the agent and any Codex/model reference.
- Derivations: non-path slots require a serialized model-selected name and typed args. The sole function uses duration from a fixed executor-routed ffprobe command; there is no eval, expression language, hidden algorithm choice, or baked per-file measurement.
- Verification: fixed ffprobe/ffmpeg/Ghostscript command builders route through the executor; verification never executes plan-supplied argv.
- Helpers: exact helper tier and granted roots; helpers cannot be primary recipe tools or install steps.
- Writes: final task outputs stay beside inputs; ordinary intermediate outputs require exact model declarations that are resolved/revalidated only inside the executor-owned temp root. Reads require an earlier declared write. Recipes use atomic temp+rename; failed outputs and every temp root are removed.
- Shelf claims: canonical names are model-authored but task-slug echoes fail closed. Replacement service/prices come only from the curated `(tool, check type)` map; unknown classes omit both fields, and kill totals deduplicate service names.
- Listener: none. Phase 3 must add `127.0.0.1`, random port, and per-session token checks before any request handling.

## Input-to-command trace

| Untrusted source | Route | Enforcement before spawn |
| --- | --- | --- |
| CLI task text | `index` → agent prompt | Treated as quoted data; never interpolated into argv. |
| CLI file paths | `filesFrom` → plan grants | Resolve + readable regular-file check; every later path is role-classified, real-path confined, and checked against the exact grant. |
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
| Network listener | None in Phase 2. Phase 3 listener remains blocked on loopback/random-port/session-token controls. |

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

## Deferred to Day 5 audit

| Severity | Item | Risk and required audit action |
| --- | --- | --- |
| High | PATH trust | Probe-discovered binary paths can inherit a poisoned launch environment. Pin/validate trusted Homebrew and system roots, ownership, permissions, and real paths before execution. |
| High | Path TOCTOU | Inputs/parents are checked before a later tool open; a local actor could swap them between validation and execution. Revalidate immediately before spawn and assess descriptor-based or immutable-directory mitigation. |
| Medium | Temp sweep | Normal cleanup works, but process death can strand `steward-run-*` and isolated LibreOffice profiles. Add an owner/mode/age-checked startup sweep. |
| Medium | Architecture enforcement | Recipes record architecture but rerun does not yet enforce compatibility. Mark recipes portable or reject/rebuild architecture-specific commands on mismatch. |
