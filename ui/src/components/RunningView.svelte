<script lang="ts">
  import { onDestroy } from "svelte";
  import {
    RUN_STEPS, type RunProgress, type RunStepName,
  } from "../lib/run-progress.ts";
  import {
    STEP_ART, STEP_TITLES, activeTool, stepDuration, stepLines, toolMark,
  } from "../lib/run-view.ts";
  import type { CheckItem, InstallRequest, Recipe, RunHistoryItem } from "../lib/stores.ts";
  import RunReceipt from "./RunReceipt.svelte";
  import StepTile from "./StepTile.svelte";

  export let progress: RunProgress;
  export let now: number;
  export let status: "running" | "complete" | "failed";
  export let outputPath: string | undefined = undefined;
  export let checks: CheckItem[] = [];
  export let savedRecipe: Recipe | undefined = undefined;
  export let matchedRecipe: string | undefined = undefined;
  export let modelCalls: 0 | undefined = undefined;
  export let killTotal = 0;
  export let installRequest: InstallRequest | null = null;
  export let onConfirmInstall: (runId: string) => void = () => undefined;
  export let recipes: Recipe[] = [];
  export let history: RunHistoryItem[] = [];
  export let onOpenRecipe: (recipe: Recipe) => void = () => {};

  const GLIDE_MS = 900;
  const OUTRO_MS = 650;
  const reducedMotion = typeof matchMedia === "function"
    && matchMedia("(prefers-reduced-motion: reduce)").matches;

  let showReceipt = false;
  let outroTimer: ReturnType<typeof setTimeout> | undefined;

  $: if (status === "complete" && !showReceipt && !outroTimer) {
    outroTimer = setTimeout(() => {
      showReceipt = true;
    }, reducedMotion ? 0 : OUTRO_MS);
  }
  $: if (status === "running" && (showReceipt || outroTimer)) {
    clearTimeout(outroTimer);
    outroTimer = undefined;
    showReceipt = false;
  }

  onDestroy(() => clearTimeout(outroTimer));

  let landed: RunStepName | undefined;
  let landTarget: RunStepName | undefined;
  let landTimer: ReturnType<typeof setTimeout> | undefined;

  function settle(next: RunStepName | undefined, instant: boolean): void {
    if (next === landTarget) {
      if (instant && landed !== next) {
        clearTimeout(landTimer);
        landed = next;
      }
      return;
    }
    landTarget = next;
    clearTimeout(landTimer);
    if (next === undefined || next === "plan" || instant || reducedMotion) {
      landed = next;
      return;
    }
    landed = undefined;
    landTimer = setTimeout(() => {
      landed = next;
    }, GLIDE_MS);
  }

  $: active = [...RUN_STEPS].reverse()
    .find((name) => progress.steps[name].status === "active");
  $: settle(active, status !== "running");
  $: activeIndex = active ? RUN_STEPS.indexOf(active) : RUN_STEPS.length;
  $: completed = RUN_STEPS.filter((name, index) =>
    (progress.steps[name].status === "complete" || progress.steps[name].status === "skipped")
      && index < activeIndex);
  $: kindOf = (name: RunStepName): "complete" | "live" | "ghost" =>
    completed.includes(name) ? "complete"
      : name === active && name === landed ? "live" : "ghost";
  $: slotIndex = (index: number) => index > activeIndex ? 4 - index : index;
  $: file = progress.request?.files[0]?.split(/[\\/]/).at(-1) ?? "local file";
  $: description = progress.request?.description ?? "Local file task";
  $: tool = activeTool(progress);
  $: statusText = status === "complete"
    ? "Local run complete"
    : status === "failed" ? "Local run stopped" : "Running locally";
</script>

<main
  class="running-stage"
  class:stage-complete={status === "complete"}
  aria-label="Steward running locally"
>
  <section class="running-card" class:running-card-poster={status === "complete"}>
    {#if !showReceipt}
      <header class="running-header" class:content-departing={status === "complete"}>
        <div class="running-wordmark">Steward<span aria-hidden="true">*</span></div>
        <div class="running-status">
          <span class="running-dot" aria-hidden="true"></span>
          <span>{statusText}</span>
        </div>
      </header>

      <div class="running-task-strip" class:content-departing={status === "complete"}>
        <span class="running-file-chip">
          <span class="running-file-glyph" aria-hidden="true"></span>
          <span>{file}</span>
        </span>
        <span class="running-task-text">{description}</span>
      </div>
    {/if}

    {#if showReceipt}
      <RunReceipt
        {progress} {checks} {savedRecipe} {matchedRecipe}
        {modelCalls} {killTotal} {outputPath} {now}
        {recipes} {history} {onOpenRecipe}
      />
    {:else}
      {#if installRequest}
        <section class="install-confirmation" aria-live="polite">
          <strong>LOCAL MODEL REQUIRED</strong>
          {#if installRequest.progress}
            <p>
              Downloading {installRequest.progress.id}: {installRequest.progress.percent}%
              ({(installRequest.progress.received / 1_000_000).toFixed(0)} /
              {(installRequest.progress.total / 1_000_000).toFixed(0)} MB)
            </p>
            <progress max="100" value={installRequest.progress.percent}></progress>
          {:else}
            <p>
              {#if installRequest.tool}{installRequest.tool} and {/if}
              {installRequest.resources.map((resource) =>
                `${resource.id} (${(resource.bytes / 1_000_000_000).toFixed(2)} GB, SHA-256 pinned)`
              ).join(", ")}
            </p>
            <button type="button" on:click={() => onConfirmInstall(installRequest.run_id)}>
              CONFIRM INSTALL & CONTINUE
            </button>
          {/if}
        </section>
      {/if}
      <div class="run-shelf" class:content-departing={status === "complete"}>
        <div class="run-items">
          {#each RUN_STEPS as name, index (name)}
            <div
              class="shelf-slot"
              class:anchor-right={index > activeIndex}
              style="--i: {slotIndex(index)}"
            >
              {#if kindOf(name) === "complete"}
                <StepTile
                  {name}
                  art={STEP_ART[name]}
                  duration={stepDuration(progress, name, now)}
                  tool={name === "execute" ? tool : ""}
                  lines={stepLines(progress, name, checks, matchedRecipe)}
                />
              {:else if kindOf(name) === "live"}
                <div
                  class="run-tile-slot run-tile-live run-step-{name}"
                  class:run-tile-stopped={status === "failed"}
                >
                  <img src={STEP_ART[name]} alt="" aria-hidden="true" />
                </div>
              {:else}
                <div class="run-tile-slot run-ghost-tile run-step-{name}">
                  <img src={STEP_ART[name]} alt="" aria-hidden="true" />
                </div>
              {/if}
            </div>
          {/each}

          {#if active}
            <div class="shelf-slot shelf-slot-panel" style="--i: {activeIndex + 1}">
              <section class="run-active-panel" aria-live="polite">
                <div class="run-panel-heading">
                  <h1>{status === "failed" ? "Run stopped" : STEP_TITLES[active]}</h1>
                  {#if active === "execute" && tool}
                    <span class="run-tool-identity" aria-label="Active tool: {tool}">
                      <span class="run-tool-mark" aria-hidden="true">{toolMark(tool)}</span>
                      <span>{tool}</span>
                    </span>
                  {/if}
                </div>
                <p class="run-command">{progress.command || progress.activity}</p>
                {#if status === "running" || progress.progress}
                  <div class="run-progress-line">
                    <span>
                      {progress.command
                        ? progress.progress || progress.activity
                        : progress.progress}
                    </span>
                    {#if status === "running"}
                      <span class="run-pinwheel" aria-hidden="true"></span>
                    {/if}
                  </div>
                {/if}
              </section>
            </div>
          {/if}
        </div>

        <div class="run-shelf-bar" aria-hidden="true"></div>
        <div class="run-labels">
          {#each RUN_STEPS as name, index (name)}
            <div
              class="shelf-slot"
              class:anchor-right={index > activeIndex}
              style="--i: {slotIndex(index)}"
            >
              {#if kindOf(name) === "ghost"}
                <div class="run-step-chip run-ghost-chip">
                  <span class="run-step-square"></span><strong>{name}</strong>
                </div>
              {:else}
                <div class="run-step-chip" data-step={name}>
                  <span class="run-step-square"></span>
                  <span>
                    <strong>{name}</strong>
                    <small>{stepDuration(progress, name, now)}</small>
                  </span>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </section>
</main>
