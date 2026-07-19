# Steward

**Your computer already knows how.**

**Ask once. Verify locally. Keep the saved command.**

Steward turns a file task into a verified local workflow. On the first run,
Codex plans the commands, Steward executes them on your Mac, and objective
checks decide whether the result is valid. A successful workflow becomes a
saved command.

Open **Past Tasks**, choose **Do Again**, and select a different file to execute
that saved command directly with `model_calls: 0`.

## How it works

1. The Codex CLI uses `gpt-5.6-sol` (GPT-5.6) to plan the first workflow.
2. Steward validates the plan, then runs literal argument arrays through its
   confined, allowlisted executor—never a model-authored shell string.
3. Fixed local verifiers measure the output against objective checks.
4. Only a verified workflow is retained as a saved command. **Do Again**
   reuses its exact commands, resources, and checks without invoking Codex.

## Install and run

Steward supports macOS on Apple Silicon (`arm64`) and Intel (`x86_64`). From the
repository root:

```sh
./install.sh
bun run server/index.ts --serve
```

The installer uses the committed lockfile, builds the production UI, and
creates the required private cache directories. It does not preinstall
workflow-specific tools or model resources.

Input file bytes remain local. Browser-selected files are staged through the
authenticated loopback server and processed by local tools; they are not
uploaded as file content. For a first-time workflow, Codex receives the task
and local planning context needed to produce the command plan. Saved-command
reruns do not call the model.

## Safety and evidence

Steward uses argv-only execution, tool and flag allowlists, path confinement,
authenticated loopback HTTP and WebSocket access, bounded repair, cleanup, and
objective verification. The exact boundaries and evidence—not just the
headline—are documented here:

- [Security audit](AUDIT.md)
- [Clean-machine Apple Silicon installation proof](demo-material/clean-machine-arm64-install-proof-55063108.txt)
- [Final safety evidence pass](demo-material/final-safety-evidence-pass-04189989.txt)

The audit still records four limitations that this release does not claim to
solve: comprehensive trust validation for binaries discovered through
`PATH`; path TOCTOU between validation and a tool opening the file; cleanup of
temporary roots after abrupt process death; and architecture compatibility
enforcement when rerunning saved commands.

## Codex collaboration disclosure

- The original core Codex thread is the `/feedback` judged artifact.
- After that thread became context-heavy, a fresh Codex chat handled
  integration and final verification.
- Claude Code performed report-only auditing and planning.
- Codex wrote the shipped code.

The repository does not contain the exact original `/feedback` session ID. It
is still needed for Devpost and is intentionally not invented here.
