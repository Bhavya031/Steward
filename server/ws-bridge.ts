import type { WsEngineOptions } from "./ws-engine.ts";
import { runEngineEvent } from "./ws-engine.ts";
import {
  type CompositionSession,
} from "./composition-session.ts";
import { ExecutionCancelledError } from "./execution-types.ts";
import { RECIPES_DIRECTORY, load } from "./recipes.ts";
import { userFacingMessage } from "./user-facing.ts";
import {
  parseClientEvent, type EmitWsEvent, type WsServerEvent,
} from "./ws-events.ts";

export interface WsSender { send(message: string): unknown }
type EngineRunner = typeof runEngineEvent;
export interface WsBridgeOptions extends WsEngineOptions { runEngine?: EngineRunner }
export interface WsBridge {
  (socket: WsSender, raw: string): Promise<void>;
  close(socket: WsSender): void;
}

function send(socket: WsSender, event: WsServerEvent): void {
  socket.send(JSON.stringify(event));
}

export function createWorkflowCatalogSender(
  directory = RECIPES_DIRECTORY,
): (socket: WsSender) => void {
  return (socket) => send(socket, { type: "workflow_catalog", workflows: load(directory) });
}

export function createWsBridge(options: WsBridgeOptions = {}): WsBridge {
  const active = new WeakSet<WsSender>();
  const pending = new WeakMap<WsSender, NonNullable<WsEngineOptions["pendingRuns"]>>();
  const pendingCompositions = new WeakMap<
    WsSender,
    NonNullable<WsEngineOptions["pendingCompositionRuns"]>
  >();
  const compositionSessions = new WeakMap<WsSender, Map<string, CompositionSession>>();
  const runner = options.runEngine ?? runEngineEvent;
  const bridge = (async (socket: WsSender, raw: string): Promise<void> => {
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
    const emit: EmitWsEvent = (event) => send(socket, event);
    try {
      let pendingRuns = pending.get(socket);
      if (!pendingRuns) {
        pendingRuns = new Map();
        pending.set(socket, pendingRuns);
      }
      let pendingCompositionRuns = pendingCompositions.get(socket);
      if (!pendingCompositionRuns) {
        pendingCompositionRuns = new Map();
        pendingCompositions.set(socket, pendingCompositionRuns);
      }
      let sessions = compositionSessions.get(socket);
      if (!sessions) {
        sessions = new Map();
        compositionSessions.set(socket, sessions);
      }
      await runner(request, emit, {
        ...options, pendingRuns, pendingCompositionRuns,
        compositionSessions: sessions,
      });
    } catch (error) {
      send(socket, {
        type: "error",
        message: `engine bridge failed: ${userFacingMessage(error)}`,
      });
    } finally {
      active.delete(socket);
    }
  }) as WsBridge;
  bridge.close = (socket): void => {
    pendingCompositions.get(socket)?.clear();
    const sessions = compositionSessions.get(socket);
    if (!sessions) return;
    for (const [runId, session] of sessions) {
      session.cancel(new ExecutionCancelledError("composition connection closed"));
      if (session.inputCleanupComplete) sessions.delete(runId);
    }
  };
  return bridge;
}
