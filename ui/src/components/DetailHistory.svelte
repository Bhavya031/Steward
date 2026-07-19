<script lang="ts">
  import type { RunHistoryItem } from "../lib/stores.ts";

  interface Props { history: RunHistoryItem[] }
  let { history }: Props = $props();

  function fileName(path: string): string {
    return path.split(/[\\/]/).at(-1) ?? path;
  }
</script>

<section class="detail-section detail-history-section" aria-labelledby="run-history-title">
  <div class="detail-section-heading">
    <span>03</span>
    <h2 id="run-history-title">Past runs</h2>
  </div>
  <div class="detail-history-list">
    {#each [...history].reverse() as run (run.runId)}
      <article class="detail-run" data-status={run.success ? "passed" : "failed"}>
        <header>
          <div>
            <span class="run-result-mark" aria-hidden="true"></span>
            <strong>{run.success ? "Verified" : "Failed · output discarded"}</strong>
          </div>
          <span class="detail-run-kind">
            {run.modelCalls === 0
              ? "Saved-command rerun"
              : run.action === "recipe" ? "Do again" : "Task run"}
          </span>
          {#if run.modelCalls === 0}
            <span class="zero-model-badge">0 model calls</span>
          {/if}
        </header>
        <p class="detail-run-file">{fileName(run.files[0] ?? "")}</p>
        <div class="detail-evidence">
          {#each run.checks as check (`${check.stageIndex ?? "atomic"}:${check.sourceId ?? ""}:${check.name}`)}
            <div data-status={check.status}>
              <span class="evidence-status" aria-hidden="true"></span>
              <strong>
                {#if check.stageIndex !== undefined}Stage {check.stageIndex + 1} · {/if}
                {check.name.replaceAll("_", " ")}
              </strong>
              <span><em>Expected</em>{check.expected ?? "—"}</span>
              <span><em>Actual</em>{check.actual ?? "—"}</span>
            </div>
          {/each}
        </div>
      </article>
    {/each}
  </div>
</section>
