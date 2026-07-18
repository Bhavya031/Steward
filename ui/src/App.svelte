<script lang="ts">
  import { onMount } from "svelte";
  import "./app.css";
  import DropSurface from "./components/DropSurface.svelte";
  import RunningView from "./components/RunningView.svelte";
  import SavedCommandDetail from "./components/SavedCommandDetail.svelte";
  import {
    checks, killTotal, recipes, runClock, runHistory, runProgress, runState,
    selectedRecipeName, type Recipe,
  } from "./lib/stores.ts";
  import { runAgainEvent } from "./lib/detail-view.ts";
  import {
    connectWebSocket, disconnectWebSocket, sendClientEvent,
  } from "./lib/ws.ts";

  let showEntry = true;
  let entryLeaving = false;
  let entryTimer: ReturnType<typeof setTimeout> | undefined;
  let transitionMs = 900;
  $: selectedRecipe = $recipes.find((recipe) => recipe.name === $selectedRecipeName);
  $: selectedHistory = selectedRecipe
    ? $runHistory.filter((run) => run.recipeName === selectedRecipe?.name)
    : [];

  function openRecipe(recipe: Recipe): void {
    selectedRecipeName.set(recipe.name);
  }

  function closeRecipe(): void {
    selectedRecipeName.set(undefined);
  }

  function runAgain(recipe: Recipe): void {
    const event = runAgainEvent(recipe.name, selectedHistory);
    if (!event) return;
    closeRecipe();
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
  <meta name="description" content="Verified local file work, saved as reusable recipes." />
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
    checks={$checks}
    savedRecipe={$runState.savedRecipe}
    matchedRecipe={$runState.matchedRecipe}
    modelCalls={$runState.modelCalls}
    killTotal={$killTotal}
    recipes={$recipes}
    history={$runHistory}
    onOpenRecipe={openRecipe}
  />
{/if}

{#if showEntry}
  <main class:entry-departing={entryLeaving} class="entry-shell" aria-label="Steward task entry">
    <DropSurface />
  </main>
{/if}
