<script lang="ts">
  import { displayArgument, templateFragments } from "../lib/detail-view.ts";

  interface Props { commands: string[][] }
  let { commands }: Props = $props();
</script>

<section class="detail-section" aria-labelledby="command-template-title">
  <div class="detail-section-heading">
    <span>01</span>
    <h2 id="command-template-title">Exact command template</h2>
  </div>
  <div class="detail-command-list">
    {#each commands as command, index}
      <div class="detail-command">
        <span class="command-index">ARGV {String(index + 1).padStart(2, "0")}</span>
        <code>
          <span class="command-prompt" aria-hidden="true">$ </span>
          {#each command as argument, argumentIndex}
            {#if argumentIndex > 0}<span> </span>{/if}
            {#each templateFragments(displayArgument(argument)) as fragment}
              {#if fragment.slot}
                <mark>{fragment.text}</mark>
              {:else}
                <span>{fragment.text}</span>
              {/if}
            {/each}
          {/each}
        </code>
      </div>
    {/each}
  </div>
</section>
