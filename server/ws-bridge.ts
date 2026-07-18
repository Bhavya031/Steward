import type { WsEngineOptions } from "./ws-engine.ts";
import { runEngineEvent } from "./ws-engine.ts";
import { RECIPES_DIRECTORY, load } from "./recipes.ts";
import { userFacingMessage } from "./user-facing.ts";
import { parseClientEvent, type EmitServerEvent, type ServerEvent } from "./ws-events.ts";

export interface WsSender { send(message: string): unknown }
type EngineRunner = typeof runEngineEvent;
export interface WsBridgeOptions extends WsEngineOptions { runEngine?: EngineRunner }

function send(socket: WsSender, event: ServerEvent): void {
  socket.send(JSON.stringify(event));
}

export function createWorkflowCatalogSender(
  directory = RECIPES_DIRECTORY,
): (socket: WsSender) => void {
  return (socket) => send(socket, { type: "workflow_catalog", workflows: load(directory) });
}

export function createWsBridge(options: WsBridgeOptions = {}) {
  const active = new WeakSet<WsSender>();
  const pending = new WeakMap<WsSender, NonNullable<WsEngineOptions["pendingRuns"]>>();
  const runner = options.runEngine ?? runEngineEvent;
  return async (socket: WsSender, raw: string): Promise<void> => {
    let request;
    try {
      request = parseClientEvent(raw);
    } catch (error) {
      send(socket, {
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    if (active.has(socket)) {
      send(socket, { type: "error", message: "a run is already active on this connection" });
      return;
    }
    active.add(socket);
    const emit: EmitServerEvent = (event) => send(socket, event);
    try {
      let pendingRuns = pending.get(socket);
      if (!pendingRuns) {
        pendingRuns = new Map();
        pending.set(socket, pendingRuns);
      }
      await runner(request, emit, { ...options, pendingRuns });
    } catch (error) {
      send(socket, {
        type: "error",
        message: `engine bridge failed: ${userFacingMessage(error)}`,
      });
    } finally {
      active.delete(socket);
    }
  };
}
