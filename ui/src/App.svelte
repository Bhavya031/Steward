<script lang="ts">
  import { onMount } from "svelte";
  import "./app.css";
  import { connectWebSocket, disconnectWebSocket } from "./lib/ws.ts";

  onMount(() => {
    connectWebSocket();
    return disconnectWebSocket;
  });
</script>

<svelte:head>
  <title>Steward</title>
  <meta name="description" content="Verified local file work, saved as reusable recipes." />
</svelte:head>

<main class="app-shell" aria-label="Steward workspace"></main>
