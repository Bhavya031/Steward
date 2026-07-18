<script lang="ts">
  import type { RunProgress } from "../lib/run-progress.ts";
  import { pipelineSegments } from "../lib/receipt-view.ts";

  let { progress }: { progress: RunProgress } = $props();
  let segments = $derived(pipelineSegments(progress));
</script>

<div class="receipt-pipeline" aria-label="Verified local pipeline">
  <img class="pipeline-node" src="/art/clapperboard-tile.png" alt="Input file" />
  {#each segments as segment, index (index)}
    <span class="pipeline-arrow" aria-hidden="true">→</span>
    <span class="pipeline-step">
      {#if segment.kind === "ffmpeg"}
        <img
          class="pipeline-node pipeline-tool"
          src="/art/ffmpeg-tile.png"
          alt=""
          aria-hidden="true"
        />
      {:else}
        <span class="pipeline-node pipeline-bash" aria-hidden="true">
          <img src="/logos/Bash_Logo_Colored.svg" alt="" />
        </span>
      {/if}
      <span class="pipeline-label">{segment.label}</span>
    </span>
  {/each}
  <span class="pipeline-arrow" aria-hidden="true">→</span>
  <span class="pipeline-node pipeline-check" aria-hidden="true"></span>
  <span class="pipeline-arrow" aria-hidden="true">→</span>
  <img class="pipeline-node" src="/art/clapperboard-tile.png" alt="Verified output" />
</div>
