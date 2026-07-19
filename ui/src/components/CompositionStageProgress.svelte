<script lang="ts">
  import type { CompositionStageProgress } from "../lib/stores.ts";
  let { stages }: { stages: CompositionStageProgress[] } = $props();
</script>

{#if stages.length > 0}
  <section class="composition-progress" aria-label="Combined command progress">
    {#each stages as stage (`${stage.stageIndex}:${stage.sourceId}`)}
      <article data-status={stage.status}>
        <header>
          <span>Stage {stage.stageIndex + 1}</span>
          <strong>{stage.sourceId.replaceAll("-", " ")}</strong>
          <em>{stage.status}</em>
        </header>
        <div>
          {#each stage.commands as command (command.index)}
            <span data-status={command.status}>
              Command {command.index + 1}
              {#if command.durationMs !== undefined}
                · {(command.durationMs / 1_000).toFixed(2)}s
              {/if}
            </span>
          {/each}
          {#each stage.checks as check (check.name)}
            <span data-status={check.status}>{check.name.replaceAll("_", " ")}</span>
          {/each}
        </div>
      </article>
    {/each}
  </section>
{/if}
