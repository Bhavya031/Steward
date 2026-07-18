<script lang="ts">
  import type { ActivityItem } from "../lib/stores.ts";

  let { items }: { items: ActivityItem[] } = $props();

  function selectVisible(source: ActivityItem[]): ActivityItem[] {
    const latest = source.slice(-7);
    let command: ActivityItem | undefined;
    for (let index = source.length - 1; index >= 0; index -= 1) {
      if (source[index]?.message.startsWith("$ ")) {
        command = source[index];
        break;
      }
    }
    return command && !latest.includes(command) ? [command, ...latest] : source.slice(-8);
  }

  let visibleItems = $derived(selectVisible(items));
</script>

<section class="operator-panel activity-panel" aria-labelledby="activity-title">
  <header class="panel-header">
    <h2 id="activity-title">01 — Activity</h2>
    <span class="panel-kicker">Local execution</span>
  </header>
  <div class="activity-log" role="log" aria-live="polite" aria-relevant="additions">
    {#if visibleItems.length === 0}
      <p class="panel-empty">Waiting for a task.</p>
    {:else}
      {#each visibleItems as item, index (`${item.runId ?? "session"}-${index}`)}
        <p
          class:command-line={item.message.startsWith("$ ")}
          class:error-line={item.kind === "error"}
        >
          {item.message}
        </p>
      {/each}
    {/if}
  </div>
</section>
