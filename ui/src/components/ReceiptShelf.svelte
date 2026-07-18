<script lang="ts">
  import { SHELF_CATALOG } from "../lib/receipt-view.ts";
</script>

<div class="receipt-shelf-row" aria-label="Recipe shelf — subscriptions replaced">
  {#each SHELF_CATALOG as card (card.name)}
    <div class="shelf-card">
      <img src={card.art} alt="" aria-hidden="true" />
      <span class="shelf-card-copy">
        <strong>{card.name}</strong>
        <em>${card.price}</em>
      </span>
    </div>
  {/each}
</div>
