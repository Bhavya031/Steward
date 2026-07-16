import type { WsEngineOptions } from "./ws-engine.ts";
import { runEngineEvent } from "./ws-engine.ts";
import { parseClientEvent, type EmitServerEvent, type ServerEvent } from "./ws-events.ts";

export interface WsSender { send(message: string): unknown }
type EngineRunner = typeof runEngineEvent;
export interface WsBridgeOptions extends WsEngineOptions { runEngine?: EngineRunner }

function send(socket: WsSender, event: ServerEvent): void {
  socket.send(JSON.stringify(event));
}

export function createWsBridge(options: WsBridgeOptions = {}) {
  const active = new WeakSet<WsSender>();
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
      await runner(request, emit, options);
    } catch (error) {
      send(socket, {
        type: "error",
        message: `engine bridge failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      active.delete(socket);
    }
  };
}
