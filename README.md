# Steward

**Your computer already knows how.**

**Ask once. Verify locally. Keep the saved command.**

Built for **OpenAI Build Week**, **Work & Productivity** track.

Steward turns a file chore into a verified local workflow. You describe the task
in plain language and drop in a file. The Codex CLI, running `gpt-5.6-sol`,
plans the work **once** and returns strict plan data — never a shell string.
Steward validates that plan, executes it through a confined argv-only executor
using an allowlisted set of local tools, and then measures the result with fixed
local verifiers. Only a workflow that passes verification is kept, as a **saved
command**. Running it again on a different file costs `model_calls: 0`. Two or
more compatible saved commands can be combined into an ordered multi-stage
workflow that also runs with `model_calls: 0`.

## How it works

1. The Codex CLI uses `gpt-5.6-sol` (GPT-5.6) to plan the first workflow.
2. Steward validates the plan, then runs literal argument arrays through its
   confined, allowlisted executor — never a model-authored shell string.
3. Fixed local verifiers measure the output against objective checks and record
   expected-versus-actual evidence.
4. Only a verified workflow is retained as a saved command. **Do Again** reuses
   its exact commands, resources, and checks without invoking Codex.

Open **Past Tasks**, choose **Do Again**, and pick a different file to execute a
saved command directly with `model_calls: 0`.

## Combining saved commands

**Combine commands** builds a multi-stage workflow from saved commands whose
declared input and output contracts line up. Steward derives each stage's
contract from its own template, so only genuinely compatible stages can be
chained, in an order you control.

- The first run of a combination and every later rerun both report
  `model_calls: 0`. Combining does not call the model.
- Each stage runs, is verified, and hands its output to the next stage. A failed
  stage stops the chain and nothing is saved.
- Live progress numbers **only the authored commands** of each stage. The
  template for a stage with one command shows exactly one numbered command.
  Verification helpers and derivation probes are real subprocesses, but they are
  reported through verification and check events rather than being counted as
  commands you did not write.
- Reopening a saved combination in **Past Tasks** fetches its detail from the
  server, so the stage and command counts you see after a reload come from the
  authoritative saved template rather than from anything the browser inferred.

## Requirements

- macOS on Apple Silicon (`arm64`) or Intel (`x86_64`).
- Homebrew at `/opt/homebrew` (Apple Silicon) or `/usr/local` (Intel).
- Apple Command Line Tools (`xcode-select --install`).
- The Codex CLI, installed and already authenticated. Steward never logs you in.
  Install it with `npm install -g @openai/codex`, then run `codex login`
  yourself before installing Steward.

## Install and run

From the repository root:

```sh
./install.sh
```

`./install.sh` is the only supported way to invoke the installer — see
[AUDIT.md](AUDIT.md) for why. The installer resolves Bun and the Codex CLI to
absolute paths, installs dependencies from the committed `bun.lockb` with
`--frozen-lockfile`, builds the production UI, and creates the private
`~/Library/Caches/Steward/models` directory. If Bun is missing it shows the
exact `brew install bun` command and asks before running it. It does not
preinstall workflow tools or model resources; those are managed later, with
confirmation, only when a task needs them.

The installer checks Codex readiness by running exactly two commands —
`codex --version` and `codex login status`. It never starts a login and never
stores credentials. If Codex is not authenticated, it stops and prints the exit
code, the diagnostic output, and a shell-safely quoted `<resolved codex> login`
command for you to run.

When it finishes, the installer prints the launch command using the same
absolute Bun binary it just used, in the form:

```
From the repository root, start Steward with:
  /opt/homebrew/bin/bun run server/index.ts --serve
```

Run the command exactly as printed. Steward binds a random free port on
`127.0.0.1` and prints a URL carrying a per-session token.

### Codex CLI resolution

Steward resolves the Codex binary in a fixed order, with no shell evaluation at
any step:

1. `STEWARD_CODEX_BIN`, if set. An explicitly set override is authoritative — if
   it is empty, missing, not a regular file, or not executable, installation and
   planning **fail closed** with an actionable error rather than falling back.
2. `$HOME/.local/bin/codex`, if executable.
3. A manual walk of `PATH`, entry by entry.

Resolution always yields an absolute executable path. If nothing is found, the
error names both remedies: install the Codex CLI, or set `STEWARD_CODEX_BIN`.

## Privacy

Input file bytes stay on your Mac. Files chosen in the browser are staged
through the authenticated loopback server and processed by local tools; their
contents are not uploaded. For a first-time workflow, Codex receives the task
text and the local planning context needed to produce a plan. Saved-command
reruns and combination runs do not call the model at all.

## Safety and evidence

Steward uses argv-only execution, tool and flag allowlists, path confinement,
authenticated loopback HTTP and WebSocket access, bounded repair, cleanup, and
objective verification. The boundaries and the evidence are documented in
[AUDIT.md](AUDIT.md); day-to-day usage is covered in [GUIDE.md](GUIDE.md) and
the file-level architecture in [MAP.md](MAP.md).

Verification status at this commit:

- 382 tests, 1,286 assertions, 61 files, zero failures.
- TypeScript clean; Svelte 0 errors, 0 warnings; production build passing.

Observed proof, reproduced on a development machine:

- A fresh, unmatched prompt planned once with the real Codex CLI — one model
  call.
- A saved atomic rerun on a different file reported `model_calls: 0`.
- A combination's first run and its later rerun both reported `model_calls: 0`.
- Final outputs were confirmed with independent `ffprobe` evidence — container
  format, duration, and the expected video and audio streams.

## Limitations

This release states only what it can support:

- The proof above was captured on a development machine. **It is not a
  clean-macOS-machine proof of the current installer.** The clean-machine
  transcript in `demo-material/` was captured against an earlier commit and does
  not cover the portable-installation work in this one.
- There is **no real Intel-machine installation proof**. Intel support is
  covered by unit tests over the architecture and Homebrew-prefix logic only.
- The audit records four open items this release does not claim to solve: trust
  validation for binaries discovered through `PATH`; path TOCTOU between
  validation and a tool opening the file; cleanup of temporary roots after
  abrupt process death; and architecture-compatibility enforcement when
  rerunning saved commands.

## Terminology

This documentation says **saved command**. Code identifiers and the `recipes/`
directory may still say *recipe*, and runtime error messages currently say
*saved workflow*; none of that naming is being changed for this submission.

## Codex collaboration disclosure

- The original core Codex thread is the `/feedback` judged artifact.
- After that thread became context-heavy, a fresh Codex chat handled integration
  and final verification.
- Claude Code performed report-only auditing, review, and planning.
- Codex wrote the shipped code.

The repository does not contain the original `/feedback` session ID. It is still
outstanding for the Devpost submission and is deliberately not invented here.
