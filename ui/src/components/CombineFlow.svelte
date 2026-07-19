<script lang="ts">
  import type { ComposableCatalogEntry } from "../../../server/composition-catalog.ts";
  import {
    addSelection, canRunComposition, compatibilityRows, ineligibleReason,
    moveSelection, removeSelection,
  } from "../lib/composition-flow.ts";
  import {
    filesFromDrop, filesFromPicker, submitComposition, type RunCompositionEvent,
  } from "../lib/task-entry.ts";
  import { compositionSubmissionPending } from "../lib/stores.ts";

  interface Props {
    catalog: ComposableCatalogEntry[];
    onRun: (event: RunCompositionEvent, inputName: string) => void;
    onClose: () => void;
  }

  let { catalog, onRun, onClose }: Props = $props();
  let name = $state("");
  let selected = $state<string[]>([]);
  let files = $state<File[]>([]);
  let staging = $state(false);
  let error = $state<string | undefined>();
  let fileInput: HTMLInputElement;
  let busy = $derived(staging || $compositionSubmissionPending);
  let links = $derived(compatibilityRows(selected, catalog));
  let canRun = $derived(canRunComposition(name, selected, files, catalog, busy));

  function choose(id: string): void {
    error = undefined;
    try {
      selected = addSelection(selected, id, catalog);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
  }

  function picked(event: Event): void {
    files = filesFromPicker((event.currentTarget as HTMLInputElement).files);
    error = files.length === 1 ? undefined : "Choose exactly one file.";
    (event.currentTarget as HTMLInputElement).value = "";
  }

  function dropped(event: DragEvent): void {
    event.preventDefault();
    files = filesFromDrop(event.dataTransfer);
    error = files.length === 1 ? undefined : "Drop exactly one file.";
  }

  async function run(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!canRun) return;
    const input = files[0];
    if (!input) return;
    staging = true;
    error = undefined;
    try {
      onRun(await submitComposition(name, selected, files), input.name);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      staging = false;
    }
  }
</script>

<section class="combine-panel" aria-labelledby="combine-title" ondragover={(event) => event.preventDefault()} ondrop={dropped}>
  <header>
    <div>
      <p>Past tasks · saved commands</p>
      <h3 id="combine-title">Combine commands</h3>
    </div>
    <button type="button" class="combine-close" onclick={onClose}>Close</button>
  </header>

  <div class="combine-grid">
    <div class="combine-catalog">
      <h4>Choose 2–8</h4>
      {#each catalog as item (item.workflow_id)}
        <button
          type="button"
          class:catalog-ineligible={!item.eligible}
          class:catalog-selected={selected.includes(item.workflow_id)}
          disabled={!item.eligible || selected.includes(item.workflow_id)}
          onclick={() => choose(item.workflow_id)}
        >
          <span>
            <strong>{item.workflow_id.replaceAll("-", " ")}</strong>
            <small>{item.stage_count} stage{item.stage_count === 1 ? "" : "s"} · {item.command_count} command{item.command_count === 1 ? "" : "s"}</small>
          </span>
          <em>{item.eligible ? "Add" : ineligibleReason(item)}</em>
        </button>
      {/each}
    </div>

    <form class="combine-order" onsubmit={run}>
      <h4>Run order</h4>
      {#if selected.length === 0}
        <p class="combine-empty">Choose saved commands from the left.</p>
      {/if}
      {#each selected as id, index (id)}
        <div class="combine-choice">
          <span><b>{index + 1}</b>{id.replaceAll("-", " ")}</span>
          <span>
            <button type="button" aria-label="Move {id} earlier" disabled={index === 0} onclick={() => selected = moveSelection(selected, index, -1)}>↑</button>
            <button type="button" aria-label="Move {id} later" disabled={index === selected.length - 1} onclick={() => selected = moveSelection(selected, index, 1)}>↓</button>
            <button type="button" aria-label="Remove {id}" onclick={() => selected = removeSelection(selected, id)}>×</button>
          </span>
        </div>
        {#if links[index]}
          <p class:compatibility-failed={!links[index].compatible} class="compatibility-row">
            {links[index].compatible ? "Compatible handoff" : links[index].reason}
          </p>
        {/if}
      {/each}

      <label>
        <span>Saved command name</span>
        <input bind:value={name} placeholder="my-media-workflow" autocomplete="off" />
        <small>Lowercase words joined with hyphens.</small>
      </label>
      <input class="sr-only" type="file" bind:this={fileInput} onchange={picked} />
      <button class="combine-file" type="button" onclick={() => fileInput.click()}>
        {files[0]?.name ?? "Choose one file"}
      </button>
      {#if error}<p class="combine-error" role="alert">{error}</p>{/if}
      <button class="combine-run" type="submit" disabled={!canRun}>
        {busy ? "Staging locally…" : "Run combined command"}
      </button>
    </form>
  </div>
</section>
