<script lang="ts">
  import { onMount } from "svelte";
  import "./app.css";
  import DropSurface from "./components/DropSurface.svelte";
  import RunningView from "./components/RunningView.svelte";
  import {
    checks, installRequest, killTotal, runClock, runProgress, runState,
  } from "./lib/stores.ts";
  import {
    connectWebSocket, disconnectWebSocket, sendClientEvent,
  } from "./lib/ws.ts";

  let showEntry = true;
  let entryLeaving = false;
  let entryTimer: ReturnType<typeof setTimeout> | undefined;
  let transitionMs = 900;

  function confirmInstall(runId: string): void {
    sendClientEvent({ type: "confirm_install", run_id: runId, confirm: true });
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

{#if !showEntry && $runState.status !== "idle"}
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
    installRequest={$installRequest}
    onConfirmInstall={confirmInstall}
  />
{/if}

{#if showEntry}
  <main class:entry-departing={entryLeaving} class="entry-shell" aria-label="Steward task entry">
    <DropSurface />
  </main>
{/if}
