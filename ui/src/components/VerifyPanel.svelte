<script lang="ts">
  import type { CheckItem } from "../lib/stores.ts";

  let { items }: { items: CheckItem[] } = $props();

  function statusLabel(status: CheckItem["status"]): string {
    if (status === "passed") return "Passed";
    if (status === "failed") return "Failed";
    return "Pending";
  }
</script>

<div class="verification-document">
  <section class="operator-panel verify-panel" aria-labelledby="verify-title">
    <header class="panel-header">
      <h2 id="verify-title">02 — Verification</h2>
      <span class="panel-kicker">Measured evidence</span>
    </header>
    {#if items.length === 0}
      <p class="panel-empty">Checks will appear when work begins.</p>
    {:else}
      <ol class="check-list" aria-live="polite">
        {#each items as item (`${item.runId}-${item.name}`)}
          <li class="check-row" data-status={item.status}>
            <div class="check-heading">
              <span
                class="status-indicator"
                role="img"
                aria-label={statusLabel(item.status)}
              ></span>
              <strong>{item.name}</strong>
            </div>
            {#if item.status !== "pending"}
              <p class="check-evidence">
                <span class="evidence-prefix">Expected</span>
                <span class="evidence-value">{item.expected}</span>
                <span class="evidence-arrow" aria-hidden="true">→</span>
                <span class="evidence-prefix">Actual</span>
                <span class="evidence-value">{item.actual}</span>
              </p>
            {/if}
          </li>
        {/each}
      </ol>
    {/if}
  </section>
  <footer class="document-footer">
    All measurements taken locally · nothing left this machine.
  </footer>
</div>
