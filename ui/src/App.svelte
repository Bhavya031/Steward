<script lang="ts">
  import { onMount } from "svelte";
  import "./app.css";
  import DropSurface from "./components/DropSurface.svelte";
  import RunningView from "./components/RunningView.svelte";
  import SavedCommandDetail from "./components/SavedCommandDetail.svelte";
  import {
    checks, composableCatalog, compositionStages, installRequest, killTotal,
    rememberCompositionInputName, runClock, runHistory, runProgress, runState,
    savedCommands, selectedRecipeName,
  } from "./lib/stores.ts";
  import type { SavedCommand } from "./lib/composition-model.ts";
  import type {
    RunCompositionEvent, RunSavedCompositionEvent,
    RunSavedWorkflowEvent, RunTaskEvent,
  } from "./lib/task-entry.ts";
  import {
    connectWebSocket, disconnectWebSocket, sendClientEvent,
  } from "./lib/ws.ts";

  let showEntry = true;
  let entryLeaving = false;
  let entryTimer: ReturnType<typeof setTimeout> | undefined;
  let transitionMs = 900;
  let requestedWorkflow: SavedCommand | undefined;
  $: selectedRecipe = $savedCommands.find((recipe) => recipe.name === $selectedRecipeName);
  $: selectedHistory = selectedRecipe
    ? $runHistory.filter((run) => run.recipeName === selectedRecipe?.name)
    : [];

  function openRecipe(recipe: SavedCommand): void {
    selectedRecipeName.set(recipe.name);
  }

  function closeRecipe(): void {
    selectedRecipeName.set(undefined);
  }

  function runAgain(recipe: SavedCommand): void {
    closeRecipe();
    entryLeaving = false;
    showEntry = true;
    requestedWorkflow = recipe;
  }

  function confirmInstall(runId: string): void {
    sendClientEvent({ type: "confirm_install", run_id: runId, confirm: true });
  }

  function denyInstall(runId: string): void {
    sendClientEvent({ type: "deny_install", run_id: runId });
  }

  function runTask(event: RunTaskEvent): void {
    sendClientEvent(event);
  }

  function runSavedWorkflow(event: RunSavedWorkflowEvent): void {
    sendClientEvent(event);
  }

  function runComposition(
    event: RunCompositionEvent | RunSavedCompositionEvent,
    inputName: string,
  ): void {
    rememberCompositionInputName(inputName);
    sendClientEvent(event);
  }

  $: if ($runState.status !== "idle" && showEntry && !entryLeaving) {
    entryLeaving = true;
    entryTimer = setTimeout(() => showEntry = false, transitionMs);
  }

  onMount(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) transitionMs = 0;
    const socket = connectWebSocket();
    const url = new URL(window.location.href);
    const proofTask = url.searchParams.get("__proof_task");
    const proofFile = url.searchParams.get("__proof_file");
    if (socket && proofTask && proofFile) {
      socket.addEventListener("open", () => sendClientEvent({
        type: "run_task", task: proofTask, files: [proofFile],
      }), { once: true });
    }
    return () => {
      disconnectWebSocket();
      if (entryTimer) clearTimeout(entryTimer);
    };
  });
</script>

<svelte:head>
  <title>Steward</title>
  <meta name="description" content="Verified local file work, saved as reusable workflows." />
</svelte:head>

{#if selectedRecipe}
  <SavedCommandDetail
    recipe={selectedRecipe}
    history={selectedHistory}
    onBack={closeRecipe}
    onRunAgain={() => runAgain(selectedRecipe)}
  />
{:else if !showEntry && $runState.status !== "idle"}
  <RunningView
    progress={$runProgress}
    now={$runClock}
    status={$runState.status}
    outputPath={$runState.outputPath}
    outputName={$runState.outputName}
    composition={$runState.composition ?? false}
    compositionStages={$compositionStages}
    checks={$checks}
    savedRecipe={$runState.savedRecipe}
    matchedRecipe={$runState.matchedRecipe}
    modelCalls={$runState.modelCalls}
    killTotal={$killTotal}
    installRequest={$installRequest}
    onConfirmInstall={confirmInstall}
    onDenyInstall={denyInstall}
    recipes={$savedCommands}
    history={$runHistory}
    onOpenRecipe={openRecipe}
  />
{/if}

{#if showEntry && !selectedRecipe}
  <main class:entry-departing={entryLeaving} class="entry-shell" aria-label="Steward task entry">
    <DropSurface
      onRunTask={runTask}
      onRunSavedWorkflow={runSavedWorkflow}
      onRunSavedComposition={runComposition}
      onRunComposition={runComposition}
      recipes={$savedCommands}
      catalog={$composableCatalog}
      history={$runHistory}
      onOpenRecipe={openRecipe}
      {requestedWorkflow}
      onRequestedWorkflowHandled={() => requestedWorkflow = undefined}
    />
  </main>
{/if}
