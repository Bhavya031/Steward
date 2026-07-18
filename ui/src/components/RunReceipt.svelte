<script lang="ts">
  import { cubicOut } from "svelte/easing";
  import { Tween } from "svelte/motion";
  import { onDestroy } from "svelte";
  import { RUN_STEPS, type RunProgress } from "../lib/run-progress.ts";
  import {
    STEP_ART, activeTool, stepDuration, stepLines, totalDuration,
  } from "../lib/run-view.ts";
  import type { CheckItem, Recipe } from "../lib/stores.ts";
  import StepTile from "./StepTile.svelte";

  interface Props {
    progress: RunProgress;
    checks: CheckItem[];
    savedRecipe?: Recipe;
    matchedRecipe?: string;
    modelCalls?: 0;
    killTotal: number;
    outputPath?: string;
    now: number;
  }

  let {
    progress, checks, savedRecipe, matchedRecipe,
    modelCalls, killTotal, outputPath, now,
  }: Props = $props();
  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  let outputFile = $derived(outputPath?.split(/[\\/]/).at(-1) ?? "Verified local output");
  let tool = $derived(activeTool(progress));
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

  onDestroy(() => {
    if (copyTimer) clearTimeout(copyTimer);
  });
</script>

<section class="run-receipt" aria-label="Verified run receipt">
  <div class="receipt-verdict">
    <div>
      <span class="receipt-kicker">Verification complete</span>
      <h1>Your file is ready.</h1>
    </div>
    <div class="receipt-output">
      <span class="receipt-kicker">Output</span>
      <strong>{outputFile}</strong>
      <button type="button" disabled={!outputPath} onclick={copyOutputPath}>
        {copied ? "Path copied" : "Reveal in Finder"}
      </button>
    </div>
  </div>

  <div class="receipt-shelf">
    <div class="receipt-tiles">
      {#each RUN_STEPS as name (name)}
        <StepTile
          {name}
          art={STEP_ART[name]}
          duration={stepDuration(progress, name, now)}
          tool={name === "execute" ? tool : ""}
          lines={stepLines(progress, name, checks, matchedRecipe)}
          mini
        />
      {/each}
    </div>
    <div class="run-shelf-bar" aria-hidden="true"></div>
    <div class="receipt-chips">
      {#each RUN_STEPS as name (name)}
        <div class="run-step-chip" data-step={name}>
          <span class="run-step-square"></span>
          <span><strong>{name}</strong><small>{stepDuration(progress, name, now)}</small></span>
        </div>
      {/each}
    </div>
  </div>

  <div class="receipt-checks">
    {#each checks as check (check.name)}
      <div class="receipt-check-row" data-status={check.status}>
        <span class="status-indicator" aria-hidden="true"></span>
        <strong>{check.name}</strong>
        <p class="check-evidence">
          <span class="evidence-prefix">Expected</span>
          <span class="evidence-value">{check.expected ?? "—"}</span>
          <span class="evidence-arrow">→</span>
          <span class="evidence-prefix">Actual</span>
          <span class="evidence-value">{check.actual ?? "—"}</span>
        </p>
      </div>
    {/each}
  </div>

  {#if savedRecipe || matchedRecipe}
    <section class="receipt-command-card">
      <span class="receipt-kicker">{savedRecipe ? "Saved command" : "Reused command"}</span>
      <h2>{savedRecipe?.name ?? matchedRecipe}</h2>
      <p>{savedRecipe ? "Future runs use zero model calls." : "Ran with zero model calls."}</p>
      {#if savedRecipe?.replaced_service}
        <strong>
          Replaces {savedRecipe.replaced_service}
          {savedRecipe.monthly_price !== undefined ? ` · $${savedRecipe.monthly_price}/mo` : ""}
        </strong>
      {/if}
    </section>
  {/if}

  <footer class="receipt-footer">
    <span>{modelCalls ?? "—"} model calls · {total} total · verified on this Mac</span>
    <strong>${killed.current.toFixed(2)}/MO KILLED</strong>
  </footer>
</section>
