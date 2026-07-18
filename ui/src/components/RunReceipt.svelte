<script lang="ts">
  import { cubicOut } from "svelte/easing";
  import { Tween } from "svelte/motion";
  import { onDestroy } from "svelte";
  import { RUN_STEPS, type RunProgress } from "../lib/run-progress.ts";
  import { totalDuration } from "../lib/run-view.ts";
  import {
    formatClock, raycastDeeplink, scriptText, stepTool,
  } from "../lib/receipt-view.ts";
  import type { CheckItem, Recipe, RunHistoryItem } from "../lib/stores.ts";
  import ReceiptPipeline from "./ReceiptPipeline.svelte";
  import ReceiptShelf from "./ReceiptShelf.svelte";

  interface Props {
    progress: RunProgress;
    checks: CheckItem[];
    savedRecipe?: Recipe;
    matchedRecipe?: string;
    modelCalls?: number;
    killTotal: number;
    outputPath?: string;
    now: number;
    recipes: Recipe[];
    history: RunHistoryItem[];
    onOpenRecipe: (recipe: Recipe) => void;
  }

  let {
    progress, checks, savedRecipe, matchedRecipe,
    modelCalls, killTotal, outputPath, now,
    recipes, history, onOpenRecipe,
  }: Props = $props();
  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  let outputFile = $derived(outputPath?.split(/[\\/]/).at(-1) ?? "Verified local output");
  let recipeName = $derived(savedRecipe?.name ?? matchedRecipe);
  let total = $derived(totalDuration(progress));
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const killed = Tween.of(() => killTotal, {
    duration: reduced ? 0 : 1_600,
    easing: cubicOut,
  });

  async function copyOutputPath(): Promise<void> {
    if (!outputPath) return;
    await navigator.clipboard.writeText(outputPath);
    copied = true;
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => copied = false, 1_500);
  }

  function saveScript(): void {
    const blob = new Blob([scriptText(progress, recipeName)], { type: "text/x-sh" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `${recipeName ?? "steward-workflow"}.sh`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }

  function saveToRaycast(): void {
    window.location.href = raycastDeeplink(progress, recipeName);
  }

  onDestroy(() => {
    if (copyTimer) clearTimeout(copyTimer);
  });
</script>

<section class="run-receipt" aria-label="Verified run receipt">
  <img class="receipt-flora receipt-flora-left" src="/art/border-flowers-left-v2.png" alt="" aria-hidden="true" />
  <img class="receipt-flora receipt-flora-right" src="/art/border-flowers-right-v2.png" alt="" aria-hidden="true" />

  <header class="receipt-masthead">
    <h1>
      Verified.<br />Yours now.<img
        class="receipt-doodle"
        src="/art/headline-flower-doodle.png"
        alt=""
        aria-hidden="true"
      />
    </h1>
    <img class="receipt-badge" src="/art/flower-badge.png" alt="" aria-hidden="true" />
  </header>

  <div class="receipt-core">
    <div class="receipt-steps">
      {#each RUN_STEPS as name (name)}
        <div class="receipt-step-row">
          <span class="receipt-tick" aria-hidden="true"></span>
          <strong>
            {name} {progress.steps[name].status === "skipped" ? "skipped" : "complete"}
          </strong>
          <span class="receipt-step-tool">{stepTool(progress, name, matchedRecipe)}</span>
          <span class="receipt-step-time">
            {progress.steps[name].status === "skipped"
              ? "SKIPPED"
              : formatClock(progress.steps[name].durationMs)}
          </span>
        </div>
      {/each}
    </div>

    <div class="receipt-file-row">
      <img src="/art/filename-flower-tile.png" alt="" aria-hidden="true" />
      <strong>{outputFile}</strong>
      <button type="button" disabled={!outputPath} onclick={copyOutputPath}>
        {copied ? "Path copied" : "Reveal in Finder"}
      </button>
    </div>

    <ReceiptPipeline {progress} />

    <div class="receipt-checks">
      {#each checks as check (check.name)}
        <div class="receipt-check-row" data-status={check.status}>
          <span class="receipt-tick" aria-hidden="true"></span>
          <strong>{check.name}</strong>
          <span class="check-cell">
            <em>Expected</em>
            <span>{check.expected ?? "—"}</span>
          </span>
          <span class="check-cell">
            <em>Actual</em>
            <span>{check.actual ?? "—"}</span>
          </span>
        </div>
      {/each}
    </div>

    <div class="receipt-actions">
      <button type="button" onclick={saveScript}>
        <span class="action-icon action-icon-bash" aria-hidden="true">
          <img src="/logos/Bash_Logo_Colored.svg" alt="" />
        </span>
        <span>Save as script</span>
      </button>
      <button type="button" onclick={saveToRaycast}>
        <span class="action-icon action-icon-raycast" aria-hidden="true">
          <i class="raycast-mark"></i>
        </span>
        <span>Save to Raycast</span>
      </button>
    </div>

    {#if recipes.length > 0}
      <ReceiptShelf {recipes} {history} onOpen={onOpenRecipe} />
    {/if}

    <footer class="receipt-footer">
      <span>{modelCalls ?? "—"} model calls · {total} total · verified on this Mac</span>
      <strong>${killed.current.toFixed(2)}/MO KILLED</strong>
    </footer>
  </div>
</section>
