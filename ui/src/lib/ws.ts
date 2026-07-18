import type { ClientEvent, ServerEvent } from "../../../server/ws-events.ts";
import { createPacer } from "./pacing.ts";
import { applyClientEvent, applyServerEvent } from "./stores.ts";

const SERVER_EVENT_TYPES: { [Type in ServerEvent["type"]]: true } = {
  run_started: true,
  activity: true,
  check_pending: true,
  check_result: true,
  repair_attempt: true,
  recipe_saved: true,
  recipe_matched: true,
  run_complete: true,
  error: true,
};

let sessionToken: string | null = null;
let socket: WebSocket | null = null;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sessionTokenFromUrl(url: URL): string {
  const token = url.searchParams.get("token");
  if (!token || token.length > 256 || token.includes("\0")) {
    throw new Error("Session token is missing or invalid.");
  }
  return token;
}

export function parseServerEvent(raw: string): ServerEvent {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Server event is not valid JSON.");
  }
  if (!record(value) || typeof value.type !== "string" ||
      !Object.hasOwn(SERVER_EVENT_TYPES, value.type)) {
    throw new Error("Server event type is unsupported.");
  }
  return value as ServerEvent;
}

function websocketUrl(token: string): string {
  const url = new URL("/ws", window.location.href);
  url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  url.search = "";
  url.searchParams.set("token", token);
  return url.toString();
}

const pacer = createPacer(applyServerEvent);

function receive(raw: string): void {
  try {
    pacer.push(parseServerEvent(raw));
  } catch (error) {
    applyServerEvent({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export function connectWebSocket(): WebSocket | null {
  if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) {
    return socket;
  }
  try {
    sessionToken ??= sessionTokenFromUrl(new URL(window.location.href));
  } catch (error) {
    applyServerEvent({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  const connection = new WebSocket(websocketUrl(sessionToken));
  socket = connection;
  connection.addEventListener("message", (event) => receive(String(event.data)));
  connection.addEventListener("error", () => applyServerEvent({
    type: "error",
    message: "Connection to Steward was interrupted.",
  }));
  connection.addEventListener("close", () => {
    if (socket === connection) socket = null;
  });
  return connection;
}

export function sendClientEvent(event: ClientEvent): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    throw new Error("Steward is not connected.");
  }
  applyClientEvent(event);
  socket.send(JSON.stringify(event));
}

export function disconnectWebSocket(): void {
  socket?.close();
  socket = null;
}
