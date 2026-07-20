# Steward usage guide

Steward is a local macOS app: a Bun + TypeScript server that serves a prebuilt
Svelte client over an authenticated loopback connection. This guide covers
installing it, running your first task, reusing and combining saved commands,
and reading what the interface tells you.

Terminology: this guide says **saved command**. Some code identifiers and the
`recipes/` directory still say *recipe*; that naming is internal and unchanged.

## 1. Before you install

You need:

- macOS on Apple Silicon (`arm64`) or Intel (`x86_64`).
- Homebrew at `/opt/homebrew` (Apple Silicon) or `/usr/local` (Intel). The
  installer refuses any other prefix.
- Apple Command Line Tools — `xcode-select --install`.
- The Codex CLI, **already authenticated**.

Steward never authenticates for you. Install and log in first:

```sh
npm install -g @openai/codex
codex login
```

## 2. Installing

From the repository root:

```sh
./install.sh
```

Run it exactly that way. `./install.sh` is the only supported invocation;
`bash install.sh` and `sh install.sh` are defended but deliberately fail closed
under a hostile environment rather than continuing (see AUDIT.md).

What it does, in order:

1. Confirms macOS and a supported architecture, and requires an absolute `HOME`.
2. Requires Homebrew at the architecture's prefix and Apple Command Line Tools.
3. Resolves Bun to an absolute executable path. If Bun is missing it prints the
   exact `brew install bun` command and waits for `y` before running it.
4. Resolves the Codex CLI to an absolute executable path (order in §3).
5. Checks Codex readiness with exactly two commands: `codex --version` and
   `codex login status`. Nothing else. It never starts a login.
6. Installs dependencies from the committed `bun.lockb` with
   `--frozen-lockfile`, then builds the production UI and requires
   `ui/dist/index.html` to exist afterwards.
7. Creates `~/Library/Caches/Steward` and `~/Library/Caches/Steward/models` with
   mode `700`.
8. Prints the launch command using the same absolute Bun binary it just used.

It does not preinstall workflow tools (ffmpeg, ocrmypdf, …) or model resources.
Those are installed later, with an explicit confirmation step, only when a task
actually needs them.

## 3. Codex CLI resolution

Resolution is fixed, ordered, and performed without any shell evaluation:

1. **`STEWARD_CODEX_BIN`** — if this variable is *set*, it is authoritative. An
   empty, missing, non-file, or non-executable value fails closed with an
   actionable message; there is no fallback. This is deliberate: an override
   that silently degrades to a different binary would be worse than an error.
2. **`$HOME/.local/bin/codex`** — used when executable.
3. **`PATH`** — walked entry by entry, manually, with no shell involved.

Success always yields an absolute executable path. If nothing matches, the error
names both remedies at once:

```
Codex CLI setup error: no executable was found. Install Codex CLI with
`npm install -g @openai/codex`, or set STEWARD_CODEX_BIN to its executable path.
```

## 4. Starting Steward

Use the command the installer printed, for example:

```sh
/opt/homebrew/bin/bun run server/index.ts --serve
```

Steward binds a random free port on `127.0.0.1` and prints a URL containing a
256-bit per-session token. Open that URL. Every HTTP and WebSocket request needs
the token; requests without it are rejected with 401 before any routing.

## 5. Your first task

1. Type what you want in plain language.
2. Add a file with the picker or by dropping it on the surface.
3. Run.

Steward first tries to match an existing saved command. If nothing matches, it
reads a local system profile and asks Codex to plan — this is the one model
call. The plan comes back as strict data: a tool, argument arrays, an output
path template, and checks. Steward validates all of it before anything runs.

You then see, live:

- each command as it starts and finishes, with real durations,
- verification starting, each check pending, and each check's result with
  expected-versus-actual evidence,
- the final output path.

If verification fails, Steward can ask Codex for a bounded repair — at most
three attempts, using only the failed evidence. A run that never verifies is not
saved and its failed output is removed.

A run that passes is saved as a saved command.

## 6. Reusing a saved command

Open **Past Tasks**, pick a saved command, and choose **Do Again** with a
different file. Steward reuses the stored commands, resources, and checks
verbatim. The receipt reports `model_calls: 0` — Codex is never contacted, and
the planner module is not even imported on this path.

The detail view shows the authored commands, the checks with their targets, and
the run history for that saved command.

## 7. Combining saved commands

**Combine commands** chains compatible saved commands into one ordered workflow.

Each saved command carries a contract describing what it accepts and what it
produces, derived from its own template. The picker shows why an entry is
ineligible rather than hiding it, and it only lets you place a stage where its
contract fits the previous stage's output. You control the order, and you name
the result.

Running a combination:

- Stages run in order. Each stage is verified before its output becomes the next
  stage's input.
- A failing stage stops the chain immediately. Later stages do not start, and
  nothing is saved.
- The first run **and** every rerun report `model_calls: 0`. Combining never
  calls the model.
- Intermediate stage outputs live in a managed temporary root that is cleaned up
  on success and on failure.

### Reading combination progress

Progress is deliberately literal:

- **Numbered commands are authored commands only.** A stage whose saved template
  contains one command shows exactly one numbered command, on a live run and
  after a page reload.
- Verification helpers (`ffprobe` and friends) and derivation probes are real
  subprocesses, but they are *not* numbered commands. They surface through
  verification and check progress instead — the stage moves to verifying, each
  check appears as pending, then each check reports its measured evidence.

This is why the stage command count you see always matches the saved template.
Reopening a saved combination fetches its detail from the server, so the counts
after a reload come from the authoritative template rather than from anything
the browser inferred.

## 8. Cancellation, disconnects, and staged files

- **Cancelling / closing the tab.** Closing the connection cancels the active
  composition run. The abort signal reaches running subprocesses, the run
  settles as cancelled, temporary roots are cleaned, and nothing is saved.
- **No replay.** On disconnect the client clears live progress state. Nothing is
  replayed or re-counted when you reconnect — you get a clean slate rather than
  a stale or double-counted timeline.
- **Staged input leases.** A browser-selected file is copied into a
  server-owned staging root as a UUID-named, mode-`0600` direct child, and is
  handed back only as an opaque ID. That ID is a **single-use lease**: claiming
  it removes it, so a stale or replayed ID fails with "staged input is unknown,
  expired, or already used". Server code never trusts a browser-supplied path.
- **Strict event validation.** WebSocket messages must be exact typed JSON, at
  most 64 KiB, with exact keys — no extras, no missing fields. Identifiers must
  be lowercase slugs of at most 64 characters. One active run per socket.

## 9. Troubleshooting

| Message | Meaning |
| --- | --- |
| `unsupported platform '…'; Steward requires macOS.` | Steward is macOS-only. |
| `unsupported Mac architecture '…'; expected arm64 or x86_64.` | Only `arm64` and `x86_64` are supported. |
| `Homebrew is required at /opt/homebrew/bin/brew. …` | Install Homebrew at the prefix for your architecture. |
| `Apple Command Line Tools are required. Run: xcode-select --install` | Install the command line tools. |
| `HOME must be set to an absolute user directory before installing Steward.` | `HOME` was unset or empty. |
| `STEWARD_CODEX_BIN is set but empty. …` | Either point the override at an executable or unset it. |
| `Codex CLI from STEWARD_CODEX_BIN is required at … ` | The override exists but is not an executable regular file. Fail-closed by design. |
| `Codex CLI was not found. Install it with 'npm install -g @openai/codex', …` | No Codex binary via override, `$HOME/.local/bin`, or `PATH`. |
| `Codex CLI authentication is unavailable (exit N): …. Run: <codex> login` | `codex login status` returned non-zero. The exit code and its output are shown, plus a shell-safely quoted login command. Run that command yourself; Steward will not. |
| `Bun installation was not approved; no changes were made.` | You declined the `brew install bun` prompt. |
| `production UI build did not create ui/dist/index.html.` | The UI build did not produce its expected output. |
| `install.sh must run under bash -p; re-exec was blocked` | The installer could not reach privileged mode. Run it as `./install.sh`. |

At runtime, `Codex planning failed (N): …` means the Codex CLI itself exited
non-zero while planning; `Codex planning timed out after 5 minutes` means it
exceeded the fixed planning timeout. Neither saves anything.

## 10. Environment variables

| Variable | Effect |
| --- | --- |
| `STEWARD_CODEX_BIN` | Authoritative Codex CLI path for both the installer and the server. Set-but-invalid fails closed with no fallback. |
| `HOME` | Must be absolute. Used for `$HOME/.local/bin/codex` lookup and the `~/Library/Caches/Steward` cache. |
| `PATH` | Searched for Codex and Bun, manually and without shell evaluation. |

## 11. Verification status

At this commit: 382 tests, 1,286 assertions across 61 files, zero failures;
TypeScript clean; Svelte 0 errors and 0 warnings; production build passing.

See [AUDIT.md](AUDIT.md) for the security posture and its limits, and
[MAP.md](MAP.md) for the file-level architecture.
