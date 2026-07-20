# Steward file map

Every tracked file at this commit, with a two-character code
`purpose/export`.

**Purpose** — C=config, D=docs, E=execution, P=planning, R=saved commands,
S=security, T=tests, U=UI, V=verify.
**Export** — A=API, Y=types, M=main, X=scripts, —=none.

Terminology note: user-facing prose says *saved command*; the code and the
`recipes/` directory still use *recipe*. The `R` purpose covers both.

## Architecture in brief

Steward is a Bun + TypeScript server that serves a prebuilt Svelte client over
an authenticated loopback connection. Layers, outermost first:

- **Entry** — `server/index.ts` runs the CLI and the `--serve` local server.
  `server/local-server.ts` binds `127.0.0.1` on a random port behind a 256-bit
  per-session token and serves `ui/dist` plus one staging route and `/ws`.
- **Protocol** — `server/ws-events.ts` and `server/ws-composition-events.ts`
  define every client and server event. `server/ws-protocol-validation.ts`
  enforces exact typed JSON, a 64 KiB cap, and slug identifiers.
  `server/ws-bridge.ts` owns per-socket state and cancels composition sessions
  when a socket closes.
- **Engine** — `server/ws-engine.ts` routes a request to a saved-command match,
  a direct rerun, or fresh planning. `server/ws-composition.ts` and its
  `ws-composition-*` siblings handle the composition protocol, installation
  flow, and run events.
- **Planning** — `server/agent.ts` resolves the Codex binary, confirms
  authentication, and invokes the CLI; `server/plan.ts` and
  `server/plan.schema.json` validate the returned plan data. Nothing in the
  rerun or composition path imports this layer, and a test enforces that.
- **Execution** — `server/executor.ts` spawns allowlisted binaries with argv
  arrays only. `server/composition-runtime.ts` runs a multi-stage workflow,
  numbering only authored stage commands. `server/repair-loop.ts` bounds repair
  attempts.
- **Verification** — `server/verify/*` builds fixed probe commands and returns
  expected-versus-actual evidence. Verifier argv is never model-supplied.
- **Policy** — the `*-policy.ts` modules and `server/path-policy.ts`,
  `server/tools.ts`, and `server/security.ts` decide what may run and where.
- **Client** — `ui/src/lib/stores.ts` reduces validated server events into
  stores; components render stores only.

Composition-specific modules: `composition-contract*.ts` derive and validate
stage compatibility, `composition-builder.ts` and `composition-catalog.ts`
assemble candidates, `composition-runtime*.ts` execute stages,
`composition-session.ts` owns cancellation, `composition-output-*.ts` confine
stage outputs, and `composition-detail.ts` serves the authoritative saved
detail used after a browser reload.

## Inventory

.gitignore:C—
AUDIT.md:D—
BRAND.md:D—
GUIDE.md:D—
MAP.md:D—
README.md:D—
bun.lockb:C—
bunfig.toml:C—
demo-material/clean-machine-arm64-install-proof-55063108.txt:D—
demo-material/clean-machine-install-failure-2026-07-19.txt:D—
demo-material/final-safety-evidence-pass-04189989.txt:D—
demo-material/installer-implementation-suite-failure-2026-07-19.txt:D—
demo-material/p3-entry-reference.jpg:D—
demo-material/p3-entry-tile-hover.jpg:D—
demo-material/p3.2-ws-compression.txt:D—
demo-material/p3.4-running-compression.jpg:D—
demo-material/real-compression-ui-collision-safe-output.jpg:D—
demo-material/real-compression-ui-completed-stage-timings.png:D—
demo-material/real-compression-ui-detail-command-check-evidence.jpg:D—
demo-material/real-compression-ui-detail-rerun-history.jpg:D—
demo-material/real-compression-ui-first-run-verified.jpg:D—
demo-material/real-compression-ui-output-pipeline-spacing.png:D—
demo-material/real-compression-ui-proof-2026-07-19-events.txt:D—
demo-material/real-compression-ui-saved-command-card-improved-layout.jpg:D—
demo-material/real-compression-ui-saved-rerun-zero-model-calls.jpg:D—
demo-material/real-ocr-ui-detail-command-check-evidence.jpg:D—
demo-material/real-ocr-ui-exit-6-diagnosis-2026-07-19.txt:D—
demo-material/real-ocr-ui-first-run-verified.jpg:D—
demo-material/real-ocr-ui-proof-2026-07-19-events.txt:D—
demo-material/real-ocr-ui-saved-rerun-product-bug.jpg:D—
demo-material/real-ocr-ui-saved-rerun-success-2026-07-19-events.txt:D—
demo-material/real-ocr-ui-saved-rerun-zero-model-calls.jpg:D—
demo-material/real-subtitles-ui-detail-pipeline-checks-history.jpg:D—
demo-material/real-subtitles-ui-first-run-verified.jpg:D—
demo-material/real-subtitles-ui-fixed-detail-pipeline-history.jpg:D—
demo-material/real-subtitles-ui-fixed-first-run-one-model-call.jpg:D—
demo-material/real-subtitles-ui-fixed-proof-2026-07-19-events.txt:D—
demo-material/real-subtitles-ui-fixed-proof-report-2026-07-19.txt:D—
demo-material/real-subtitles-ui-fixed-saved-rerun-zero-model-calls.jpg:D—
demo-material/real-subtitles-ui-install-confirmation.jpg:D—
demo-material/real-subtitles-ui-model-download-progress.jpg:D—
demo-material/real-subtitles-ui-proof-2026-07-19-events.txt:D—
demo-material/real-subtitles-ui-proof-report-2026-07-19.txt:D—
demo-material/real-subtitles-ui-rerun-used-model-receipt.jpg:D—
demo-material/real-subtitles-ui-saved-rerun-no-match-bug.jpg:D—
demo-material/recipe-4-verification-failure.txt:D—
demo-material/recipe-5-ocr-rerun.txt:D—
demo-material/recipe-5-ocr.txt:D—
demo-material/recipe-6-subtitles.txt:D—
demo-material/release-suite-2026-07-19.txt:D—
demo-material/repair-derivation-final-suite-2026-07-19.txt:D—
demo-material/repair-run-1.txt:D—
demo-material/repair-verification-failure.txt:D—
demo-material/reuse-ux-detail-history.jpg:D—
demo-material/reuse-ux-direct-zero-model-receipt.jpg:D—
demo-material/reuse-ux-past-tasks-token-free-home.jpg:D—
demo-material/reuse-ux-proof-2026-07-19.txt:D—
docs/PHASE_3_UI.md:D—
install.sh:SX
package.json:CX
recipes/compress-video-under-25mb.json:R—
recipes/convert-markdown-to-docx.json:R—
recipes/convert-media-to-mov.json:R—
recipes/convert-media-to-mp4.json:R—
recipes/normalize-audio-to-14-lufs.json:R—
recipes/ocr-scanned-pdf.json:R—
recipes/transcribe-video-to-srt.json:R—
server/agent-invocation.test.ts:T—
server/agent-prompts.ts:PA
server/agent.ts:PA
server/attempt-types.ts:EY
server/check-policy.ts:SA
server/command-path.ts:SA
server/composition-builder.test.ts:T—
server/composition-builder.ts:RA
server/composition-catalog.ts:RA
server/composition-cleanup.test.ts:T—
server/composition-cleanup.ts:EA
server/composition-contract-derivation.ts:RA
server/composition-contract-validation.ts:SA
server/composition-contract.test.ts:T—
server/composition-contract.ts:RA
server/composition-detail.ts:RA
server/composition-installation.ts:EA
server/composition-output-allocation.ts:SA
server/composition-output-root.ts:SA
server/composition-runtime-failure.test.ts:T—
server/composition-runtime-state.ts:EA
server/composition-runtime-test-helpers.ts:TA
server/composition-runtime-types.ts:EY
server/composition-runtime.test.ts:T—
server/composition-runtime.ts:EA
server/composition-session.ts:EA
server/composition-validation.test.ts:T—
server/composition-validation.ts:SA
server/derivation-runtime.ts:EA
server/derivations.test.ts:T—
server/derivations.ts:PY
server/document-policy.ts:SA
server/execution-policy.ts:SA
server/execution-types.ts:EY
server/executor-cancellation.test.ts:T—
server/executor-multi.test.ts:T—
server/executor.test.ts:T—
server/executor.ts:EA
server/failed-output.ts:SA
server/ffprobe-policy.ts:SA
server/flag-policy-core.ts:SY
server/flag-policy-doc.ts:SA
server/flag-policy-ffmpeg.ts:SA
server/flag-policy-media.ts:SA
server/flag-policy.test.ts:T—
server/flag-policy.ts:SA
server/helper-executor.test.ts:T—
server/helper-policy.ts:SA
server/index.ts:EM
server/input-staging.ts:SA
server/install-policy.ts:SA
server/install-script.test.ts:T—
server/installation-runtime.ts:EA
server/intermediate-executor.test.ts:T—
server/intermediate-policy.test.ts:T—
server/intermediate-policy.ts:SY
server/local-server.test.ts:T—
server/local-server.ts:SA
server/loudness-policy.ts:SA
server/media-formats.ts:RY
server/output-allocation.test.ts:T—
server/output-allocation.ts:SA
server/output-policy.ts:SA
server/path-error.ts:SY
server/path-policy.test.ts:T—
server/path-policy.ts:SA
server/plan-paths.ts:SA
server/plan.schema.json:P—
server/plan.test.ts:T—
server/plan.ts:PA
server/probe.test.ts:T—
server/probe.ts:SA
server/process-cancellation.ts:EA
server/process-stream.ts:EA
server/recipe-cleanup.test.ts:T—
server/recipe-integrity.test.ts:T—
server/recipe-intermediate.test.ts:T—
server/recipe-match.test.ts:T—
server/recipe-match.ts:RA
server/recipe-persistence.ts:RA
server/recipe-runtime.ts:RA
server/recipe-snapshot-validation.test.ts:T—
server/recipe-snapshot-validation.ts:SA
server/recipe-template.ts:RA
server/recipe-types.ts:RY
server/recipe-validation.ts:RA
server/recipes.test.ts:T—
server/recipes.ts:RA
server/repair-integrity.ts:SA
server/repair-loop.test.ts:T—
server/repair-loop.ts:EA
server/repair-policy.test.ts:T—
server/replacement-prices.test.ts:T—
server/replacement-prices.ts:RA
server/runtime-temp.ts:SA
server/security.ts:SA
server/soffice-profile.ts:SA
server/source-graph.ts:TA
server/staged-input-lease.test.ts:T—
server/staged-input-registry.ts:SA
server/subtitle-contract.test.ts:T—
server/terminal.ts:DA
server/test-fixtures.ts:TA
server/tools.ts:SA
server/trusted-resources.test.ts:T—
server/trusted-resources.ts:SA
server/two-pass-policy.ts:SA
server/user-facing.test.ts:T—
server/user-facing.ts:SA
server/verify/audio.test.ts:T—
server/verify/audio.ts:VA
server/verify/common.ts:VA
server/verify/doc.ts:VA
server/verify/document-format.test.ts:T—
server/verify/file-format.ts:VA
server/verify/index.ts:VA
server/verify/loudness-parser.test.ts:T—
server/verify/loudness-parser.ts:VA
server/verify/media-format.test.ts:T—
server/verify/media-format.ts:VA
server/verify/pdf-ocr.ts:VA
server/verify/pdf-parser.test.ts:T—
server/verify/pdf.test.ts:T—
server/verify/pdf.ts:VA
server/verify/srt.test.ts:T—
server/verify/srt.ts:VA
server/verify/text-inspector.ts:VA
server/verify/types.ts:VY
server/verify/video-truncation.test.ts:T—
server/verify/video.test.ts:T—
server/verify/video.ts:VA
server/verify/zip-inspector.ts:VA
server/ws-bridge.test.ts:T—
server/ws-bridge.ts:SA
server/ws-composition-cancellation.test.ts:T—
server/ws-composition-detail.test.ts:T—
server/ws-composition-events.ts:EY
server/ws-composition-install.test.ts:T—
server/ws-composition-install.ts:EA
server/ws-composition-protocol.test.ts:T—
server/ws-composition-run-events.ts:EA
server/ws-composition-run.test.ts:T—
server/ws-composition-run.ts:EA
server/ws-composition-services.ts:EY
server/ws-composition.ts:EA
server/ws-direct-rerun.test.ts:T—
server/ws-engine.ts:EA
server/ws-events.ts:EY
server/ws-install-flow.ts:EA
server/ws-protocol-validation.ts:SA
server/ws-run-events.test.ts:T—
server/ws-run-events.ts:EA
tsconfig.json:C—
ui/index.html:U—
ui/public/art/06-orange-key-tile-transparent.png:U—
ui/public/art/07-blue-shears-tile-transparent.png:U—
ui/public/art/08-green-olive-tile-transparent.png:U—
ui/public/art/border-flowers-left-v2.png:U—
ui/public/art/border-flowers-right-v2.png:U—
ui/public/art/clapperboard-tile.png:U—
ui/public/art/complete_flower_plant_transparent.png:U—
ui/public/art/compress-video-tile.png:U—
ui/public/art/convert-format-tile.png:U—
ui/public/art/ffmpeg-tile.png:U—
ui/public/art/filename-flower-tile.png:U—
ui/public/art/flower-badge.png:U—
ui/public/art/hammer.png:U—
ui/public/art/headline-flower-doodle.png:U—
ui/public/art/olive-branch-transparent.png:U—
ui/public/art/refreence.png:U—
ui/public/art/remove-silence-tile.png:U—
ui/public/art/verify-output-tile.png:U—
ui/public/art/verify.png:U—
ui/public/logos/Bash_Logo_Colored.svg:U—
ui/public/logos/logo.svg:U—
ui/src/App.svelte:UM
ui/src/app.css:U—
ui/src/components/ActivityStream.svelte:U—
ui/src/components/CombineFlow.svelte:U—
ui/src/components/CompositionDetailBody.svelte:U—
ui/src/components/CompositionStageProgress.svelte:U—
ui/src/components/DetailChecks.svelte:U—
ui/src/components/DetailCommand.svelte:U—
ui/src/components/DetailHistory.svelte:U—
ui/src/components/DropSurface.svelte:U—
ui/src/components/ReceiptPipeline.svelte:U—
ui/src/components/ReceiptShelf.svelte:U—
ui/src/components/RunReceipt.svelte:U—
ui/src/components/RunningView.svelte:U—
ui/src/components/SavedCommandDetail.svelte:U—
ui/src/components/StepTile.svelte:U—
ui/src/components/VerifyPanel.svelte:U—
ui/src/lib/composition-detail.test.ts:T—
ui/src/lib/composition-flow.test.ts:T—
ui/src/lib/composition-flow.ts:UA
ui/src/lib/composition-model.ts:UA
ui/src/lib/composition-stores.test.ts:T—
ui/src/lib/detail-view.test.ts:T—
ui/src/lib/detail-view.ts:UA
ui/src/lib/pacing.test.ts:T—
ui/src/lib/pacing.ts:UA
ui/src/lib/receipt-view.test.ts:T—
ui/src/lib/receipt-view.ts:UA
ui/src/lib/run-progress-state.ts:UA
ui/src/lib/run-progress.test.ts:T—
ui/src/lib/run-progress.ts:UA
ui/src/lib/run-view.ts:UA
ui/src/lib/stores.test.ts:T—
ui/src/lib/stores.ts:UA
ui/src/lib/task-entry.test.ts:T—
ui/src/lib/task-entry.ts:UA
ui/src/lib/ws-event-validation.ts:UA
ui/src/lib/ws.test.ts:T—
ui/src/lib/ws.ts:UA
ui/src/main.ts:UM
ui/svelte.config.js:C—
ui/tsconfig.json:C—
ui/vite.config.ts:C—
