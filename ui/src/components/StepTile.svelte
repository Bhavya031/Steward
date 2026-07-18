<script lang="ts">
  import type { RunStepName } from "../lib/run-progress.ts";

  interface Props {
    name: RunStepName;
    art: string;
    duration: string;
    tool?: string;
    lines: string[];
    mini?: boolean;
  }

  let { name, art, duration, tool = "", lines, mini = false }: Props = $props();
  let pinned = $state(false);
  let hovered = $state(false);
  let focused = $state(false);
  let open = $derived(pinned || hovered || focused);
</script>

<div
  class="run-tile-slot run-tile-complete run-step-{name}"
  class:mini
  class:open
  role="group"
  onmouseenter={() => hovered = true}
  onmouseleave={() => hovered = false}
  onfocusin={() => focused = true}
  onfocusout={() => focused = false}
>
  <button
    class="run-tile-button"
    type="button"
    aria-label="{name} step details"
    aria-expanded={open}
    onclick={() => pinned = !pinned}
  >
    <img src={art} alt="" aria-hidden="true" />
  </button>

  {#if open}
    <aside class="run-tile-popover" aria-live="polite">
      <header>
        <strong>{name}</strong>
        <span>{duration}{name === "execute" && tool ? ` · ${tool}` : ""}</span>
      </header>
      <div>
        {#each lines as line}
          <p>{line}</p>
        {/each}
        {#if lines.length === 0}<p>No additional detail reported.</p>{/if}
      </div>
    </aside>
  {/if}
</div>
