<script lang="ts">
  import {
    compositionDetailRows, type CompositionCommand,
  } from "../lib/composition-model.ts";
  import type { RunHistoryItem } from "../lib/stores.ts";
  import DetailCommand from "./DetailCommand.svelte";
  import DetailHistory from "./DetailHistory.svelte";

  interface Props {
    command: CompositionCommand;
    history: RunHistoryItem[];
  }
  let { command, history }: Props = $props();
  let stages = $derived(compositionDetailRows(command));
</script>

<section class="composition-detail" aria-label="Combined command stages">
  <div class="detail-section-heading">
    <span>01</span>
    <h2>Verified stages</h2>
  </div>
  {#if stages.length === 0}
    <p class="composition-detail-note">
      Loading verified stage details from Steward…
    </p>
  {:else}
    <div class="composition-stage-list">
      {#each stages as stage (stage.stageIndex)}
        <article class="composition-stage-card">
          <header>
            <span>Stage {stage.stageIndex + 1}</span>
            <strong>{stage.sourceTitle}</strong>
            <code>{stage.tools.join(" · ")}</code>
          </header>
          <div class="composition-stage-grid">
            <DetailCommand commands={stage.commands} />
            <section class="detail-section" aria-label="Stage verification checks">
              <div class="detail-section-heading">
                <span>02</span>
                <h2>Verification contract</h2>
              </div>
              <div class="detail-check-list">
                {#each stage.checks as check (check.checkId)}
                  <article
                    class="detail-check"
                    data-stage-index={check.stageIndex}
                    data-source-id={check.sourceId}
                    data-check-id={check.checkId}
                  >
                    <span class="detail-check-mark" aria-hidden="true"></span>
                    <div>
                      <strong>{check.name.replaceAll("_", " ")}</strong>
                      <p>Verified against the saved stage contract.</p>
                    </div>
                    <code>{String(check.target)}</code>
                  </article>
                {/each}
              </div>
            </section>
          </div>
          <p class="composition-detail-note">
            Output template <code>{stage.outputTemplate}</code>
          </p>
          {#if stage.resources.length > 0}
            <p class="composition-detail-note">
              Declared resources: {stage.resources.join(", ")}
            </p>
          {/if}
        </article>
      {/each}
    </div>
  {/if}

  <div class="composition-export-note">
    <strong>Exports stay inside Steward</strong>
    <p>Combined commands use managed handoffs and verification between stages.</p>
    <button type="button" disabled>Save as script unavailable</button>
    <button type="button" disabled>Save to Raycast unavailable</button>
  </div>

  {#if history.length > 0}
    <DetailHistory {history} />
  {/if}
</section>
