<script lang="ts">
  import { formatPrice } from "../lib/detail-view.ts";
  import { toolMark } from "../lib/run-view.ts";
  import type { Recipe, RunHistoryItem } from "../lib/stores.ts";

  interface Props {
    recipes: Recipe[];
    history: RunHistoryItem[];
    onOpen: (recipe: Recipe) => void;
    onDoAgain?: (recipe: Recipe) => void;
  }

  let { recipes, history, onOpen, onDoAgain }: Props = $props();
</script>

<div class="receipt-shelf-row" aria-label="Saved workflow shelf">
  {#each recipes as recipe (recipe.name)}
    <article class="shelf-card">
      <button
        class="shelf-card-main"
        type="button"
        aria-label="Open details for {recipe.name.replaceAll('-', ' ')}"
        onclick={() => onOpen(recipe)}
      >
        <span class="shelf-card-tile" aria-hidden="true">{toolMark(recipe.tool)}</span>
        <span class="shelf-card-copy">
          <strong>{recipe.name.replaceAll("-", " ")}</strong>
          <span class="shelf-card-meta">
            {#if recipe.replaced_service && recipe.monthly_price !== undefined}
              <em>{recipe.replaced_service} · ${formatPrice(recipe.monthly_price)}/mo</em>
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
