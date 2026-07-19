<script lang="ts">
  import { formatPrice } from "../lib/detail-view.ts";
  import {
    isCompositionCommand, type SavedCommand,
  } from "../lib/composition-model.ts";
  import { toolMark } from "../lib/run-view.ts";
  import type { RunHistoryItem } from "../lib/stores.ts";

  interface Props {
    recipes: SavedCommand[];
    history: RunHistoryItem[];
    onOpen: (recipe: SavedCommand) => void;
    onDoAgain?: (recipe: SavedCommand) => void;
    onCombine?: () => void;
  }

  let { recipes, history, onOpen, onDoAgain, onCombine }: Props = $props();
</script>

<div class="receipt-shelf-row" aria-label="Saved workflow shelf">
  {#if onCombine}
    <article class="shelf-card shelf-card-combine">
      <button class="shelf-card-main" type="button" onclick={onCombine}>
        <span class="shelf-card-tile" aria-hidden="true">＋</span>
        <span class="shelf-card-copy">
          <strong>Combine</strong>
          <small>Link 2–8 saved commands</small>
        </span>
      </button>
    </article>
  {/if}
  {#each recipes as recipe (recipe.name)}
    <article class="shelf-card">
      <button
        class="shelf-card-main"
        type="button"
        aria-label="Open details for {recipe.name.replaceAll('-', ' ')}"
        onclick={() => onOpen(recipe)}
      >
        <span class="shelf-card-tile" aria-hidden="true">
          {isCompositionCommand(recipe) ? `${recipe.stage_count}→` : toolMark(recipe.tool)}
        </span>
        <span class="shelf-card-copy">
          <strong>{recipe.name.replaceAll("-", " ")}</strong>
          <span class="shelf-card-meta">
            {#if !isCompositionCommand(recipe) && recipe.replaced_service && recipe.monthly_price !== undefined}
              <em>{recipe.replaced_service} · ${formatPrice(recipe.monthly_price)}/mo</em>
            {/if}
            {#if isCompositionCommand(recipe)}
              <small>{recipe.stage_count} verified stages</small>
            {/if}
            {#if history.some((run) => run.recipeName === recipe.name && run.modelCalls === 0)}
              <small>0 model calls</small>
            {/if}
          </span>
        </span>
      </button>
      {#if onDoAgain}
        <button
          class="shelf-card-again"
          type="button"
          aria-label="Do {recipe.name.replaceAll('-', ' ')} again with a new file"
          onclick={() => onDoAgain?.(recipe)}
        >
          Do again
        </button>
      {/if}
    </article>
  {/each}
</div>
