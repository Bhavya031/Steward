# Security audit

Scope: the execution, planning, protocol, installation, and browser boundaries
as they exist in the current source. Where this document and the source ever
disagree, the source is correct and this document is the defect.

Verification at this commit: 382 tests, 1,286 assertions across 61 files, zero
failures; TypeScript clean; Svelte 0 errors and 0 warnings; production build
passing.

Terminology: user-facing prose says *saved command*; code identifiers and the
`recipes/` directory still say *recipe*.

## 1. Threat model

Steward assumes a single-user macOS machine where the user is trusted and the
**model is not**. The model may return any bytes; it never receives a shell, and
its output is treated as data that must survive validation before anything runs.
Steward also assumes local network exposure is hostile: another process on the
machine, or a web page in the user's browser, may attempt to reach the loopback
listener.

Explicitly outside the model: an attacker who can already execute arbitrary code
as the user. Anyone who can set `BASH_ENV`, replace `~/.local/bin/codex`, or
write to the user's shell startup files has already won by a shorter route than
Steward, and no in-process guard can undo that. §5 states where this boundary
lands for the installer.

## 2. Execution surface

- **Fresh tasks.** Task text reaches the model prompt only, never argv. Model
  plans pass exact-shape and profile validation, canonical-name and
  semantic-check validation, closed derivation and intermediate validation,
  positive per-tool flag classification, and role-based real-path confinement
  before the executor sees argv.
- **Repairs.** Evidence contains the authored plan, failed expected/actual
  values, and bounded stderr only. Revised plans repeat the full validation path
  and must preserve the canonical name plus every check and target. Repair is
  capped at three attempts.
- **Saved-command reruns.** Validated saved command → local path slots plus
  serialized named derivations → the same executor and verifier. The resolved
  source graph excludes the agent and any Codex or model reference, and a test
  enforces that reachability property.
- **Derivations.** Non-path slots require a serialized model-selected name and
  typed args. The sole function uses duration from a fixed executor-routed
  `ffprobe` command; there is no eval, expression language, hidden algorithm
  choice, or baked per-file measurement.
- **Verification.** Fixed `ffprobe`, `ffmpeg`, and Ghostscript command builders
  route through the executor; verification never executes plan-supplied argv.
- **Helpers.** Exact helper tier with absolute paths under `/bin` and
  `/usr/bin`, and granted roots; helpers cannot be primary tools or install
  steps.
- **Allowlist.** Primary binaries are exactly `ffmpeg`, `ffprobe`, `pandoc`,
  `magick`, `ocrmypdf`, `whisper-cli`, `gs`, `soffice`, and `brew`; each carries
  a fixed install weight and a fixed install argv. Nothing else can be spawned
  as a primary tool.
- **Writes.** Final outputs stay beside inputs and are allocated without
  overwrite using the first available deterministic `-2`, `-3`, … suffix.
  Ordinary intermediate outputs require exact model declarations resolved and
  revalidated only inside the executor-owned temp root; reads require an earlier
  declared write. Saved commands use atomic temp-plus-rename. Failed outputs and
  every temp root are removed.
- **Listener.** Bun binds `127.0.0.1` on a random free port. A 256-bit
  per-session token is required by query or HttpOnly SameSite cookie for static
  and staging requests, and by query for `/ws`; missing or wrong tokens return
  401 before routing. Static real paths remain inside `ui/dist`.

## 3. Protocol and client surface

- **Message validation.** Client JSON is capped at 64 KiB and must exactly match
  a known event shape — exact keys, exact types, no extras. Identifiers must be
  lowercase slugs of at most 64 characters. File grants must be absolute,
  readable regular files. One active run per socket prevents overlapping
  mutations.
- **Staged input leases.** Browser-selected bytes are copied to a UUID-named,
  mode-`0600` direct child of a server-owned staging root. The browser receives
  an opaque ID, never a path. Claiming an ID consumes it, so replayed or stale
  IDs fail closed with "staged input is unknown, expired, or already used". A
  claimed path is re-checked to be a regular file directly inside the staging
  root.
- **Cancellation.** Each composition run owns a session with an abort signal.
  Cancelling aborts in-flight subprocesses, marks the session cancelled,
  suppresses further events, cleans temporary roots, and saves nothing.
- **Disconnect.** Closing a socket cancels that socket's composition sessions
  and clears pending state. The client clears live progress rather than
  replaying it, so a reconnect cannot resurrect or double-count a timeline.
- **Browser client.** One module-scoped WebSocket takes the per-session token
  from the startup URL and connects only to same-origin `/ws`. Registered server
  events flow through one exhaustive store reducer. Client-side typing is
  convenience only; the server parser remains the enforcement boundary.

## 4. Composition surface

- **Schema.** A saved composition is `kind: "composition"` with ordered stages.
  Each stage carries `source_id`, `command_template`, `checks`, `tool`,
  `install_weight`, optional `derivations`, `intermediates`, and `resources`,
  and its own `composition_contract`. Stages are validated with the same
  strictness as atomic saved commands.
- **Compatibility.** Each stage's contract is derived from its own template.
  Chaining is permitted only where one stage's output contract satisfies the
  next stage's input contract; ineligible entries are surfaced with a reason
  rather than silently dropped.
- **Model calls.** A composition's first run and every rerun report
  `model_calls: 0`. The composition runtime's module graph cannot reach the
  planner, the agent, or any Codex reference, and a test enforces it.
- **Confinement.** Intermediate stage outputs are allocated inside a managed
  per-run root with mode `700`; only the final stage writes beside the original
  input. Failed outputs are discarded and every managed root is cleaned on both
  success and failure.
- **Live-progress honesty.** Only **authored** stage commands are reported as
  numbered `composition_command_started` / `composition_command_completed`
  events. Verification helpers and derivation probes execute as real
  subprocesses but are routed away from the numbered reporter; they surface
  through `composition_check_pending`, `composition_verification_started`,
  `composition_verification_completed`, and `composition_check_result` with
  measured expected-versus-actual evidence. A stage whose saved template holds
  one command therefore shows exactly one numbered command, live and after a
  reload. This was a real defect: helper subprocesses were previously numbered
  as authored commands, so a one-command stage displayed several. Regressions
  now cover both the verification-helper and derivation-probe routes.
- **Authoritative detail.** Reopening a saved composition fetches
  `composition_detail` from the server. Stage and command counts after a browser
  reload come from the saved template, not from browser-side inference.

## 5. Installation surface

The installer is `install.sh`. Its job is to resolve tools, verify readiness,
install pinned dependencies, and build the UI — never to authenticate.

### Supported invocation

**`./install.sh` is the sole supported invocation.** It is the only form that
guarantees the hardening below, because it is the only form in which the kernel
honours the `#!/bin/bash -p` shebang.

`bash install.sh` and `sh install.sh` are defended, not supported: they bypass
the shebang, so the script re-executes itself under `bash -p`, and if that
re-exec is blocked they **fail closed** rather than continuing unprivileged.

### Privileged-mode hardening

Bash imports exported shell functions from the environment and sources
`BASH_ENV` *before* a script's first line runs. Without hardening, a caller
could replace the built-ins the installer uses to resolve executables. The
defenses, in the order they take effect:

1. **`#!/bin/bash -p`.** Privileged mode refuses to import environment functions
   and skips `BASH_ENV`, enforced by the interpreter at startup, before anything
   shadowable can execute.
2. **Re-exec guard.** A `case $-` test detects a non-privileged shell and
   re-executes via `exec /bin/bash -p "$0" "$@"`, covering shebang-bypassing
   invocations.
3. **Fail-closed backstop.** `exec` is itself a builtin and can be shadowed by
   an imported function, so a swallowed re-exec is caught by a
   `${…[1]:?}` parameter expansion. It is resolved during word expansion, before
   command lookup, so no function or alias can intercept it; the `[1]` subscript
   keeps it fatal even when a caller exports a same-named environment variable,
   because an environment variable is always a scalar.
4. **`__STEWARD_SELF` capture.** Calling a shadowed builtin pushes and pops a
   function context, which leaves `BASH_SOURCE` empty at top level on Bash 3.2 —
   exactly in the attack case. The script captures `${BASH_SOURCE[0]}` into
   `__STEWARD_SELF` in a plain assignment on its first executable line, before
   anything can run, and both guards test that captured value. An
   environment-supplied value is overwritten.
5. **`[[ ]]` throughout.** Every conditional uses `[[ ]]`, a reserved word. This
   matters: `[` is an ordinary builtin, and an exported `[` function returning 0
   would make every `-f` and `-x` executable check succeed.
6. **`builtin` at resolution call sites.** `builtin cd`, `builtin pwd`,
   `builtin printf`, `builtin read`, and `builtin command` are used where a
   value or a decision depends on them, so the resolution functions stay correct
   even when sourced without the prologue.
7. **Post-privilege cleanup.** Once privileged mode is guaranteed,
   `unalias -a`, `shopt -u expand_aliases`, and `unset -f` over the relevant
   builtin names run as defense in depth.

Verified against stock `/bin/bash` 3.2.57 and Homebrew Bash 5.x: `-p` is honored
from the shebang, blocks environment function import, and skips `BASH_ENV` on
both.

**Known limit — `BASH_ENV` (review finding N6).** A caller-controlled `BASH_ENV`
can define a real array before line 1 of a non-privileged shell and thereby
defeat the backstop on the `bash install.sh` path. This is outside the threat
model of §1: setting `BASH_ENV` already grants arbitrary code execution in every
non-interactive Bash the user runs, and it is not closable from inside a script
whose interpreter was subverted before its first line. `./install.sh` is immune,
because `-p` makes Bash ignore `BASH_ENV` outright. This is the reason the
supported-invocation rule above is stated as a rule and not a preference.

**Comment scope correction (review finding N7).** The comment at the top of
`install.sh` states that privileged mode blocks environment functions and
`BASH_ENV` "at interpreter startup". That is accurate only when the shebang is
honored — that is, for `./install.sh`. For `bash install.sh` with `BASH_ENV`
set, the guarantee does not hold, per N6 above. The code comment is left as-is;
this paragraph is the accurate scope.

### Codex resolution

Ordered, with no shell evaluation at any step:

1. `STEWARD_CODEX_BIN` if **set** — authoritative. Empty, missing, non-file, or
   non-executable values fail closed with an actionable error and **no
   fallback**, so an override can never silently degrade to a different binary.
2. `$HOME/.local/bin/codex` if executable.
3. A manual, entry-by-entry walk of `PATH`.

Resolution always returns an absolute executable path, or an error naming both
remedies. `HOME` must be set and absolute; a missing or empty `HOME` fails with
a specific message rather than a generic `set -u` error. An empty `PATH` is safe
under `set -u`. Directories and non-executable files can never be selected,
because every candidate is checked for both `-f` and `-x`. No developer-specific
fallback path remains in either `install.sh` or `server/agent.ts`, and tests
assert its absence.

### Readiness, not authentication

The installer runs exactly two Codex commands: `codex --version` and
`codex login status`. It never invokes planning, never consumes a model call,
never initiates a login, and never stores credentials.

A non-zero `login status` is captured rather than thrown: the failure message
carries the exit code, the captured output, and a shell-safely quoted
`<resolved codex> login` command for the user to run. Quoting is proven
behaviorally — tests build Codex paths containing spaces, single and double
quotes, backslashes, dollar signs, semicolons, and command substitutions, then
execute the printed instruction and assert that no injection marker file is
created.

### Bun and build integrity

Bun is resolved to an absolute executable path, and that exact binary performs
the frozen-lockfile install and the UI build; the launch command printed at the
end names the same binary, safely quoted, so nothing depends on the next shell's
`PATH`. Dependencies come from the committed `bun.lockb` via `--frozen-lockfile`.
The build must produce `ui/dist/index.html` or installation fails. Homebrew is
required at `/opt/homebrew` on Apple Silicon and `/usr/local` on Intel, Bun
installation requires visible consent before running an exact allowlisted
`brew install bun`, and trusted downloadable resources are checksum-validated.

## 6. Input-to-command trace

| Untrusted source | Route | Enforcement before spawn |
| --- | --- | --- |
| CLI task text | `index` → agent prompt | Treated as quoted data; never interpolated into argv. |
| CLI file paths | `filesFrom` → plan grants | Resolve plus readable regular-file check; every later path is role-classified, real-path confined, and checked against the exact grant. |
| WS task/name/files | typed parser → engine bridge | Exact event keys and types, bounded strings and files, one active run per socket, absolute readable grants. |
| Browser-selected file | authenticated staging route → staging root | Token checked before routing; plain filename only; UUID-prefixed exclusive `0600` direct child; returned real path must remain inside the staging root. |
| Staged input ID | single-use lease claim | Unknown, expired, or reused IDs fail closed; the claimed path is re-validated as a direct child regular file. |
| Browser client event | singleton `ws.ts` → authenticated `/ws` | The server re-parses exact runtime keys and types and reapplies every file and plan policy; client typing is not trusted. |
| Model plan or repair | plan → repair loop → executor | Strict keys and types, one primary tool, argv arrays only, semantic check targets, canonical name, declared slots and intermediates, per-tool flags, output confinement, timeout. |
| Saved command JSON | load → slot render → executor | Strict validation; only path slots and serialized derivations; the rendered plan is revalidated; no agent-reachable module. |
| Composition selection | contract derivation → stage validation | Stage compatibility derived from templates; incompatible or unknown selections are rejected before any stage runs. |
| Derivation input | first granted file → `ffprobe` duration | Fixed argv through the executor, closed named formula, typed model-authored args. |
| Verification target | dispatcher → fixed verifier builder | Registered types and semantic targets only; verifier argv is fixed and executor-routed. |
| `STEWARD_CODEX_BIN` | resolution → absolute path | Must be an executable regular file; invalid values fail closed with no fallback. |

## 7. File writes and listeners

| Surface | Policy |
| --- | --- |
| Final output | One declared output, confined beside the input; occupied names and symlinks are skipped for deterministic suffixes, with execution validation still failing closed on a race. |
| Browser-staged input | Unique direct child of a per-server temp root, created exclusively with mode `0600`; traversal names fail before creation and partial writes are removed. |
| Ordinary intermediates | Declared direct children of one per-run temp root; write-before-read enforced; root removed on pass and on fail. |
| Composition stage outputs | Managed per-run root with mode `700`; only the final stage writes beside the original input; roots cleaned on success and failure. |
| Executor artifacts | ffmpeg passlogs and null sinks and isolated LibreOffice profiles stay in executor-owned temp roots and are cleaned. |
| Saved command JSON | Green runs only; atomic exclusive temp write plus rename under `recipes/`. |
| Model cache | `~/Library/Caches/Steward` and its `models` child, created with mode `700`. |
| Failed output cleanup | Regular files only, never inputs or symlinks; invoked after failed reruns, failed stages, and terminal repair exhaustion. |
| Network listener | Loopback only, random port, per-session token before static, staging, or WS routing; typed WS messages are size and shape bounded. |

## 8. Closed critical findings

| Severity | Finding | Resolution |
| --- | --- | --- |
| Critical | Model-controlled `output_path` could target arbitrary writable locations. | Output and parent are resolved after symlinks and confined to input and temp roots; existing and dangling output symlinks fail closed. |
| Critical | Allowlisted binaries accepted dangerous model-controlled flags and embedded file sources. | Every token is positively classified per tool; path roles are validated; GS pipe and unsafe mode, ffmpeg lavfi and movie sources, and pandoc execution hooks are explicitly denied. |
| High | A caller-controlled `PATH` could substitute the `dirname` and `basename` helpers the installer used for path normalization. | Normalization uses Bash parameter expansion and built-in directory operations; the installer references no external path helper, and a test asserts a poisoned helper never executes. |
| High | Caller-exported shell functions could shadow the built-ins used for executable resolution, including via a swallowed `exec`. | Privileged-mode shebang, re-exec guard, expansion-time fail-closed backstop, `__STEWARD_SELF` capture, `[[ ]]` conditionals, and `builtin` call sites (§5). |
| High | A hard-coded developer Codex path made installation non-portable. | Ordered override → `$HOME/.local/bin` → shell-free `PATH` resolution, with fail-closed override handling and tests asserting no developer path remains. |
| High | `confirmCodexAuth()` threw on a non-zero status before producing actionable guidance, and its login path was not safely quoted. | Exit code, stdout, and stderr are captured and reported, with a shell-safely quoted login command proven non-executable by test. |
| High | Composition verification helpers and derivation probes were reported as numbered authored commands, so live progress overstated a stage's command count. | Helper and derivation subprocesses are routed away from the numbered reporter and surface through verification and check events; regressions cover both routes. |
| High | Failed outputs blocked retries and could be mistaken for successful artifacts. | Non-green exits and terminal repair failure remove regular-file outputs without touching inputs. |
| High | Basename-only module graph could hide an agent import behind `index.ts` collisions. | Tests use canonical repo-relative paths, scan reachability hazards, and independently bundle the rerun entry. |
| High | A legitimate repair could not write an ordinary intermediate, while widening temp access risked restoring arbitrary writes. | Plans and saved commands may serialize exact direct-child temp intermediates; undeclared, escaping, input-directory, and read-before-write paths fail closed. |
| High | Generic runtime slots could hide code-invented behavior or bake one input's measurement into every rerun. | Every non-path slot requires a serialized model-declared named derivation with closed typed args; unknown and unused derivations and baked loudnorm measurements fail closed. |
| High | Type-correct but meaningless check targets could create false evidence or make repair futile. | Check targets and cross-check compatibility are validated before execution and again when loading saved commands. |
| High | A localhost UI listener could expose execution controls to DNS rebinding or CSRF, write attacker-chosen paths, or serve files outside its build root. | Loopback and random-port binding plus a 256-bit token gates every HTTP and WS request; static paths are realpath-confined, and staging uses rejected traversal names plus exclusive UUID direct children. |
| Medium | Model or task wording and guessed SaaS prices could make shelf claims misleading. | Canonical names reject task-slug echoes; service and price claims are code-curated, unknown classes render no claim, and shared services count once. |

## 9. Evidence and its limits

Observed behavior, reproduced on a development machine:

- A fresh, unmatched prompt planned once with the real Codex CLI — one model
  call.
- A saved atomic rerun on a different file reported `model_calls: 0`.
- A composition's first run and its later rerun both reported `model_calls: 0`.
- Final outputs were confirmed with independent `ffprobe` evidence: container
  format, duration, and the expected video and audio streams.

Limits, stated plainly:

- **No current clean-machine proof exists.** The clean-machine transcripts in
  `demo-material/` were captured against historical commits `5506310` and
  `069798e`, both of which predate the portable installer and the
  privileged-mode hardening in §5. They are retained as historical records and
  **do not cover the current installer**. A development-machine run is not a
  substitute for a disposable-clone proof at a frozen commit.
- **No real Intel-machine installation proof exists.** Intel support rests on
  unit coverage of the architecture and Homebrew-prefix logic only.
- Installer hardening is verified statically and by regression tests, including
  mutation checks that confirm each guard fails when reverted. It has not been
  exercised end to end on a machine that never had Steward installed.

## 10. Remaining audit items

| Severity | Item | Risk and required action |
| --- | --- | --- |
| High | PATH trust | Binaries discovered through `PATH` can inherit a poisoned launch environment. Pin and validate trusted Homebrew and system roots, ownership, permissions, and real paths before execution. |
| High | Path TOCTOU | Inputs and parents are checked before a later tool opens them; a local actor could swap them in between. Revalidate immediately before spawn and assess descriptor-based or immutable-directory mitigation. |
| Medium | Temp sweep | Normal cleanup works, but process death can strand `steward-run-*` roots and isolated LibreOffice profiles. Add an owner, mode, and age-checked startup sweep. |
| Medium | Architecture enforcement | Saved commands record architecture but rerun does not enforce compatibility. Mark them portable or reject and rebuild architecture-specific commands on mismatch. |
| Low | Test-coverage gaps | Two known gaps, both correctness-neutral: the composition cancellation test passes even when the helper abort signal is removed, because run-level checkpoints abort independently; and the UI store test locks the event contract but cannot fail from a server-side regression. |
