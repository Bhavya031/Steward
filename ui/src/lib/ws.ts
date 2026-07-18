import type { ClientEvent, ServerEvent } from "../../../server/ws-events.ts";
import { createPacer } from "./pacing.ts";
import { applyClientEvent, applyServerEvent } from "./stores.ts";

const SERVER_EVENT_TYPES: { [Type in ServerEvent["type"]]: true } = {
  workflow_catalog: true,
  run_started: true,
  activity: true,
  model_call_count: true,
  command_started: true,
  command_completed: true,
  verification_started: true,
  verification_completed: true,
  install_required: true,
  install_progress: true,
  install_complete: true,
  check_pending: true,
  check_result: true,
  repair_attempt: true,
  recipe_saved: true,
  recipe_matched: true,
  workflow_selected: true,
  run_complete: true,
  error: true,
};

let sessionToken: string | null = null;
let socket: WebSocket | null = null;
const SESSION_TOKEN_KEY = "steward.session-token";

type SessionStorage = Pick<Storage, "getItem" | "setItem">;
type ReplaceUrl = (url: string) => void;

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

function validStoredToken(value: string | null): string | null {
  return value && value.length <= 256 && !value.includes("\0") ? value : null;
}

export function captureStartupSession(
  url: URL,
  storage: SessionStorage = window.sessionStorage,
  replaceUrl: ReplaceUrl = (clean) =>
    window.history.replaceState(window.history.state, "", clean),
): string {
  const queryToken = url.searchParams.get("token");
  const storedToken = validStoredToken(storage.getItem(SESSION_TOKEN_KEY));
  if (sessionToken === null) {
    sessionToken = queryToken === null ? storedToken : sessionTokenFromUrl(url);
  } else if (queryToken !== null && sessionTokenFromUrl(url) !== sessionToken) {
    throw new Error("The startup session token does not match this browser session.");
  }
  if (!sessionToken) throw new Error("Session token is missing or invalid.");
  storage.setItem(SESSION_TOKEN_KEY, sessionToken);
  if (queryToken !== null) {
    const clean = new URL(url);
    clean.searchParams.delete("token");
    replaceUrl(`${clean.pathname}${clean.search}${clean.hash}`);
  }
  return sessionToken;
}

export function sessionTokenForRequest(url?: URL): string {
  if (sessionToken) return sessionToken;
  if (url) return sessionTokenFromUrl(url);
  throw new Error("Session token is missing or invalid.");
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
  let token: string;
  try {
    token = captureStartupSession(new URL(window.location.href));
  } catch (error) {
    applyServerEvent({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  const connection = new WebSocket(websocketUrl(token));
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

export function resetSessionAuthForTests(): void {
  sessionToken = null;
}
