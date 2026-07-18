<script lang="ts">
  import {
    EXAMPLE_TASKS, canSubmitTask, filesFromDrop, filesFromPicker,
    populateTaskFromExample, submitTask, type RunTaskEvent,
  } from "../lib/task-entry.ts";

  interface Props { onRunTask: (event: RunTaskEvent) => void }
  let { onRunTask }: Props = $props();
  let task = $state("");
  let files = $state<File[]>([]);
  let busy = $state(false);
  let error = $state<string | undefined>();
  let fileInput: HTMLInputElement;
  let canRun = $derived(canSubmitTask(task, files, busy));
  let status = $derived(error
    ? `Local / ${error}`
    : busy
      ? `Local / staging ${files.length} file${files.length === 1 ? "" : "s"}`
      : files.length > 0
        ? `Local / ${files.length} file${files.length === 1 ? "" : "s"} selected`
        : "Local / nothing uploaded");

  function selectPicked(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    files = filesFromPicker(input.files);
    error = undefined;
    input.value = "";
  }

  function selectDropped(event: DragEvent): void {
    event.preventDefault();
    files = filesFromDrop(event.dataTransfer);
    error = undefined;
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
  </div>

  <img
    class="entry-branch"
    src="/art/olive-branch-transparent.png"
    alt=""
    aria-hidden="true"
  />
</section>
