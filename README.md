<h1 align="center">Steward</h1>

<p align="center"><strong>Your computer already knows how.</strong></p>

<p align="center">
A local macOS app that turns a plain-language task and a file into a
<strong>verified, reusable command</strong> — planned by GPT-5.6, run entirely on your Mac.
</p>

<p align="center"><em>OpenAI Build Week · Work &amp; Productivity</em></p>

<p align="center">
  <img src="demo-material/steward-home-4k.png" alt="Steward entrance screen: describe a task, attach a file, run it locally" width="820">
</p>

---

## Watch it work

**Demo walkthrough:** [youtu.be/2MfCul45hmg](https://youtu.be/2MfCul45hmg)

**Full uncut run:** [youtu.be/BFZc4Jtzv7I](https://youtu.be/BFZc4Jtzv7I)

---

## Install

**One line.** Paste it in Terminal:

```sh
curl -fsSL https://raw.githubusercontent.com/Bhavya031/Steward/main/install.sh | bash
```

That **clones Steward** and runs the installer. No checkout required first.

**Prefer to see the code before you run it?** Clone, then install:

```sh
git clone https://github.com/Bhavya031/Steward.git && cd Steward && ./install.sh
```

**You need:** macOS · Homebrew · Apple Command Line Tools (`xcode-select --install`) · the **Codex CLI, already logged in** (`npm install -g @openai/codex` then `codex login` — Steward never logs you in).

The installer prints the exact launch command. Run it as printed:

```sh
<the bun path it prints> run server/index.ts --serve
```

Steward opens on a private `127.0.0.1` address with a per-session token. **Nothing is hosted. Nothing is shared.**

> **Security note.** The one-line install reads over a pipe, so it clones and then **hands control to the hardened on-disk installer**. For privileged-mode hardening from the very first line, use the **git-clone** install above — it is the fully-hardened path.

---

## The idea, in one flow

**Ask once. Verify locally. Keep the command.**

1. **Describe it.** Type a task in plain language, drop in a file.
2. **Codex plans it.** GPT-5.6 returns a **strict plan** — a tool, argument arrays, an output path, and checks. **Data, never a shell string.**
3. **Steward validates it.** Every argument is checked against per-tool policy **before anything runs**.
4. **It runs once.** A confined, argv-only executor runs the plan on your Mac.
5. **It proves it worked.** Fixed local verifiers measure the output and record **expected-vs-actual** evidence.
6. **It becomes yours.** A verified run is saved as a **command** that reruns with **`model_calls: 0`** — no model, no cost, forever.

---

## Why it's different

- **Open-ended, not a menu.** You describe the problem in your words — **Codex figures out the tool and the flags.**
- **Objective proof, not vibes.** Every run is **verified against measured evidence** (file size, duration, streams, format). A run that can't be proven **isn't saved**.
- **It compounds.** Each verified task **accumulates as a reusable command.** The second time is free and instant.
- **It teaches.** Steward **shows you the real command** it ran — so the CLI stops being a black box.

---

## What ships

**Seven verified starter commands**, each mapped to a paid service it replaces:

| Command | Tool | Replaces |
| --- | --- | --- |
| **Compress video under 25 MB** | `ffmpeg` | Clideo — $9/mo |
| **Convert to MP4** | `ffmpeg` | CloudConvert — $8/mo |
| **Convert to MOV** | `ffmpeg` | CloudConvert — $8/mo |
| **Normalize audio to −14 LUFS** | `ffmpeg` | Auphonic — $11/mo |
| **Markdown → DOCX** | `pandoc` | Convertio — $6.99/mo |
| **OCR a scanned PDF** | `ocrmypdf` | iLovePDF — $5/mo |
| **Transcribe video → SRT** | `whisper-cli` | *(local, free)* |

**Multi-step shipped as Combine — not batch.** There is **no multi-file batch mode.** What shipped is **Combine**: chain **2–8 saved commands** (up to 8 argv arrays total) into one ordered, verified workflow. Each stage is verified before it feeds the next, and the **whole chain runs at `model_calls: 0`** — first run and every rerun.

---

## Architecture

**The model plans. Your Mac does everything else.**

- **Plan-only model.** Codex returns a **strict JSON plan** and nothing else — it **never** gets a shell, a path it invented, or a free-form command.
- **The command *is* the plan.** A saved command stores the **exact plan template that just passed** — same argv arrays, checks, derivations. Rerun **replays it verbatim.** No second, drifting representation.
- **Argv-only executor.** Runs over a **curated tool allowlist** with **positive per-flag classification** and **path confinement** — never a model-authored string.
- **Evidence-based verification.** Fixed `ffprobe` / `ffmpeg` / Ghostscript probes produce **expected-vs-actual** results the executor path can't fake.
- **One authenticated channel.** A single WebSocket plus a **256-bit per-session token** — every request without it is rejected before routing.
- **Curated price map.** Replacement claims are a **hand-verified, deduplicated** table — not model-invented numbers.

---

## Security

**Loopback-only, argv-only, proven-or-discarded.**

- **Local surface only.** Binds `127.0.0.1` on a **random free port**, guarded by a **256-bit `base64url` per-session token** (`randomBytes(32)`), compared in **constant time**.
- **Output-path confinement.** The output and its parent are resolved **after symlinks** and confined to the **input and temp roots** — existing and dangling output symlinks **fail closed**.
- **Positive flag allowlist.** **Every token is classified per tool.** Anything not explicitly permitted is denied — no denylist gaps.
- **The verifier never runs plan argv.** Checks use **fixed probe commands only**, so a plan can't smuggle work through its own verification.
- **Two independently-found criticals — both closed:**
  - **Model-controlled `output_path` could target arbitrary writable locations** → now resolved post-symlink and confined to input/temp roots.
  - **Allowlisted binaries accepted dangerous model-controlled flags and embedded sources** → every token is positively classified; **Ghostscript pipe/unsafe, ffmpeg `lavfi`/`movie`, and pandoc execution hooks are explicitly denied.**

Full boundary in **[AUDIT.md](AUDIT.md)**.

---

## Testing

**383 tests · 1,293 assertions · 61 files · all green.**

- **Server suite: 383 pass / 0 fail**, run under `bun test`.
- **Svelte-check: 377 files · 0 errors · 0 warnings.**
- **Zero-model-call is a *test*, not a promise.** `recipes.test.ts` resolves the rerun's **module graph** and independently **bundles the rerun entry**, then asserts neither can reach **`server/agent.ts`** — the planner is **not even importable** on the rerun path.
- **The installer is tested as hostile input.** Executable resolution, privileged-mode re-exec, fail-closed backstops, and **"no `eval` / `sh -c` / `curl` / `wget`"** are all asserted.
- **Security invariants are covered:** output confinement, per-flag classification, staged-input single-use leases, derivation typing.
- **Motion is accessible.** The UI respects **`prefers-reduced-motion`** throughout.

---

## Impact

**Meet Maya — a freelance video editor.**

She owes a client a **sub-25 MB cut by midnight**, needs the audio at broadcast **−14 LUFS**, and has to hand over an **SRT** and a **DOCX** of the brief. Today that's **four browser tabs and five subscriptions**.

- **Steward replaces $39.99/mo of tools** — Clideo, CloudConvert, Auphonic, Convertio, iLovePDF, **deduplicated** to real distinct services.
- **Real, verified result:** *"Compress this video under 1 MB"* → Codex derived a **1152 kbps** bitrate → output **900,553 bytes (879 KB)**, **proven** under the 1,000,000-byte cap by `ffprobe`.
- **The second time is free.** After the first verified run, Maya's compress command reruns at **`model_calls: 0`** — a property the module-graph test **guarantees**, not just claims.

She never learns a flag. She never uploads a byte. She stops paying five companies for what her Mac already does.

---

## Powered by OpenAI

This was built in one week, and it was only possible because of **GPT-5.6** and **Codex**.

- **GPT-5.6-Sol (`gpt-5.6-sol`) — the planner and the thinking partner.** It turns a plain-language task plus a local system profile into a **strict, validated plan**: data, never a shell string. At **extra-high reasoning**, it was also the partner for the architecture itself — the confinement model, the verification contract, the command-is-the-plan invariant.
- **Codex CLI — the builder.** Codex wrote the **shipped code**: the argv-only executor, the evidence-based verifiers, the hardened installer, and the **383 green tests** that hold all of it in place.

The best part: **Steward runs on Codex inside itself.** The same engine that built it is the engine it calls to plan your first run.

---

## Try it

**Live and testable through August 5, 2026.** Install with the one-liner above, drop in a file, and ask.
