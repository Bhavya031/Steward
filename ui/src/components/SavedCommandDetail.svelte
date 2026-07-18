<script lang="ts">
  import type { Recipe, RunHistoryItem } from "../lib/stores.ts";
  import { formatPrice } from "../lib/detail-view.ts";
  import { toolMark } from "../lib/run-view.ts";
  import DetailChecks from "./DetailChecks.svelte";
  import DetailCommand from "./DetailCommand.svelte";
  import DetailHistory from "./DetailHistory.svelte";

  interface Props {
    recipe: Recipe;
    history: RunHistoryItem[];
    onBack: () => void;
    onRunAgain: () => void;
  }

  let { recipe, history, onBack, onRunAgain }: Props = $props();
  let canRun = $derived(history.some((run) => run.files.length > 0));
</script>

<main class="detail-stage" aria-label="Saved command detail">
  <article class="detail-card">
    <nav class="detail-nav" aria-label="Saved command navigation">
      <button type="button" onclick={onBack}>
        <span aria-hidden="true">←</span> Back to shelf
      </button>
      <div class="detail-wordmark">Steward<span aria-hidden="true">*</span></div>
    </nav>

    <header class="detail-hero">
      <div class="detail-brand-tile" aria-label="{recipe.tool} saved command">
        <strong>{toolMark(recipe.tool)}</strong>
        <span>{recipe.tool}</span>
      </div>
      <div class="detail-title">
        <p>Saved command · verified locally</p>
        <h1>{recipe.name.replaceAll("-", " ")}</h1>
        <div class="detail-meta">
          <code>{recipe.tool} · {recipe.arch}</code>
          {#if recipe.replaced_service && recipe.monthly_price !== undefined}
            <s>{recipe.replaced_service} · ${formatPrice(recipe.monthly_price)}/mo</s>
          {/if}
        </div>
      </div>
      <button class="detail-run-again" type="button" disabled={!canRun} onclick={onRunAgain}>
        Run again <span aria-hidden="true">▶</span>
      </button>
    </header>

    <div class="detail-body">
      <DetailCommand commands={recipe.command_template.commands} />
      <DetailChecks checks={recipe.checks} />
      {#if history.length > 0}
        <DetailHistory {history} />
      {/if}
    </div>
  </article>
</main>
