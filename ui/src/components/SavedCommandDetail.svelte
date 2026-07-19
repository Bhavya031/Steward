<script lang="ts">
  import {
    isCompositionCommand, type SavedCommand,
  } from "../lib/composition-model.ts";
  import type { RunHistoryItem } from "../lib/stores.ts";
  import { formatPrice } from "../lib/detail-view.ts";
  import { toolMark } from "../lib/run-view.ts";
  import DetailChecks from "./DetailChecks.svelte";
  import DetailCommand from "./DetailCommand.svelte";
  import DetailHistory from "./DetailHistory.svelte";
  import CompositionDetailBody from "./CompositionDetailBody.svelte";

  interface Props {
    recipe: SavedCommand;
    history: RunHistoryItem[];
    onBack: () => void;
    onRunAgain: () => void;
  }

  let { recipe, history, onBack, onRunAgain }: Props = $props();
  let authoritativeModelCalls = $derived(
    [...history].reverse().find((run) => run.modelCalls !== undefined)?.modelCalls,
  );
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
      <div class="detail-brand-tile" aria-label="Saved command">
        <strong>{isCompositionCommand(recipe) ? `${recipe.stage_count}→` : toolMark(recipe.tool)}</strong>
        <span>{isCompositionCommand(recipe) ? "combined" : recipe.tool}</span>
      </div>
      <div class="detail-title">
        <p>Saved command · verified locally</p>
        <h1>{recipe.name.replaceAll("-", " ")}</h1>
        <div class="detail-meta">
          <code>
            {isCompositionCommand(recipe)
              ? `${recipe.stage_count} stages${authoritativeModelCalls === undefined
                ? "" : ` · ${authoritativeModelCalls} model calls`}`
              : `${recipe.tool} · ${recipe.arch}`}
          </code>
          {#if !isCompositionCommand(recipe) && recipe.replaced_service && recipe.monthly_price !== undefined}
            <s>{recipe.replaced_service} · ${formatPrice(recipe.monthly_price)}/mo</s>
          {/if}
        </div>
      </div>
      <button class="detail-run-again" type="button" onclick={onRunAgain}>
        Do again <span aria-hidden="true">▶</span>
      </button>
    </header>

    {#if isCompositionCommand(recipe)}
      <CompositionDetailBody command={recipe} {history} />
    {:else}
      <div class="detail-body">
        <DetailCommand commands={recipe.command_template.commands} />
        <DetailChecks checks={recipe.checks} />
        {#if history.length > 0}
          <DetailHistory {history} />
        {/if}
      </div>
    {/if}
  </article>
</main>
