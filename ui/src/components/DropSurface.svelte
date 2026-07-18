<script lang="ts">
  import {
    EXAMPLE_TASKS, canSubmitTask, filesFromDrop, filesFromPicker,
    populateTaskFromExample, submitSavedWorkflow, submitTask,
    type RunSavedWorkflowEvent, type RunTaskEvent,
  } from "../lib/task-entry.ts";
  import type { Recipe, RunHistoryItem } from "../lib/stores.ts";
  import ReceiptShelf from "./ReceiptShelf.svelte";

  interface Props {
    onRunTask: (event: RunTaskEvent) => void;
    onRunSavedWorkflow: (event: RunSavedWorkflowEvent) => void;
    recipes: Recipe[];
    history: RunHistoryItem[];
    onOpenRecipe: (recipe: Recipe) => void;
    requestedWorkflow?: Recipe;
    onRequestedWorkflowHandled?: () => void;
  }
  let {
    onRunTask, onRunSavedWorkflow, recipes, history, onOpenRecipe,
    requestedWorkflow, onRequestedWorkflowHandled,
  }: Props = $props();
  let task = $state("");
  let files = $state<File[]>([]);
  let busy = $state(false);
  let error = $state<string | undefined>();
  let repeatWorkflow = $state<Recipe | undefined>();
  let handledRequest = $state<string | undefined>();
  let fileInput: HTMLInputElement;
  let canRun = $derived(canSubmitTask(task, files, busy));
  let status = $derived(error
    ? `Local / ${error}`
    : busy
      ? `Local / staging ${files.length} file${files.length === 1 ? "" : "s"}`
      : repeatWorkflow
        ? `Local / choose a new file for ${repeatWorkflow.name.replaceAll("-", " ")}`
      : files.length > 0
        ? `Local / ${files.length} file${files.length === 1 ? "" : "s"} selected`
        : "Local / nothing uploaded");

  async function runSavedSelection(selected: File[]): Promise<void> {
    if (!repeatWorkflow || selected.length === 0) return;
    const workflow = repeatWorkflow;
    busy = true;
    error = undefined;
    try {
      onRunSavedWorkflow(await submitSavedWorkflow(workflow.name, selected));
      repeatWorkflow = undefined;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      busy = false;
    }
  }

  async function selectPicked(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    files = filesFromPicker(input.files);
    error = undefined;
    input.value = "";
    await runSavedSelection(files);
  }

  async function selectDropped(event: DragEvent): Promise<void> {
    event.preventDefault();
    files = filesFromDrop(event.dataTransfer);
    error = undefined;
    await runSavedSelection(files);
  }

  function chooseNewFile(recipe: Recipe): void {
    repeatWorkflow = recipe;
    files = [];
    error = undefined;
    fileInput.click();
  }

  async function run(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!canRun) return;
    busy = true;
    error = undefined;
    try {
      onRunTask(await submitTask(task, files));
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      busy = false;
    }
  }

  $effect(() => {
    if (requestedWorkflow && fileInput && handledRequest !== requestedWorkflow.name) {
      handledRequest = requestedWorkflow.name;
      chooseNewFile(requestedWorkflow);
      onRequestedWorkflowHandled?.();
    }
  });
</script>

<section
  class="entry-stage"
  aria-labelledby="entry-title"
  ondragover={(event) => event.preventDefault()}
  ondrop={selectDropped}
>
  <img
    class="entry-flower"
    src="/art/complete_flower_plant_transparent.png"
    alt=""
    aria-hidden="true"
  />

  <div class="entry-card">
    <header class="entry-masthead">
      <div class="entry-wordmark">Steward<span aria-hidden="true">*</span></div>
      <div class="device-pill">
        <span class="device-dot" aria-hidden="true"></span>
        <span>On this Mac</span>
        <span class="device-chevron" aria-hidden="true"></span>
      </div>
    </header>

    <h1 id="entry-title">How can Steward<br />help you today?</h1>

    <form class="task-composer" onsubmit={run}>
      <label class="sr-only" for="task-description">Describe the local file task</label>
      <textarea
        id="task-description"
        rows="3"
        placeholder="Describe the task you want to run on your Mac..."
        bind:value={task}
      ></textarea>
      <input
        class="sr-only"
        type="file"
        multiple
        bind:this={fileInput}
        onchange={selectPicked}
      />
      <div class="composer-actions">
        <button
          class="add-file"
          type="button"
          aria-label="Add a file"
          disabled={busy}
          onclick={() => fileInput.click()}
        >
          <span class="plus-glyph" aria-hidden="true"></span>
        </button>
        <button class="run-task" type="submit" aria-label="Run task" disabled={!canRun}>▶</button>
      </div>
    </form>

    <div class="local-status">
      <span class="device-dot" aria-hidden="true"></span>
      <span>{status}</span>
    </div>

    <div class="example-area">
      <div class="tile-row" aria-hidden="true">
        <img src="/art/06-orange-key-tile-transparent.png" alt="" />
        <img src="/art/07-blue-shears-tile-transparent.png" alt="" />
        <img src="/art/08-green-olive-tile-transparent.png" alt="" />
      </div>
      <div class="example-commands">
        <span class="example-label">Example commands</span>
        <div class="chip-row">
          {#each EXAMPLE_TASKS as example}
            <button
              class="example-chip"
              type="button"
              onclick={() => task = populateTaskFromExample(example)}
            >
              <span>{example}</span><span aria-hidden="true">›</span>
            </button>
          {/each}
        </div>
      </div>
    </div>

    {#if recipes.length > 0}
      <section class="past-tasks" aria-labelledby="past-tasks-title">
        <h2 id="past-tasks-title">Past tasks</h2>
        <ReceiptShelf
          {recipes}
          {history}
          onOpen={onOpenRecipe}
          onDoAgain={chooseNewFile}
        />
      </section>
    {/if}
  </div>

  <img
    class="entry-branch"
    src="/art/olive-branch-transparent.png"
    alt=""
    aria-hidden="true"
  />
</section>
