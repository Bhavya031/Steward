import type { WsClientEvent, WsServerEvent } from "../../../server/ws-events.ts";
import { createPacer } from "./pacing.ts";
import {
  applyClientEvent, applyServerEvent, handleConnectionClosed, handleConnectionOpened,
} from "./stores.ts";
import { isWsServerEvent } from "./ws-event-validation.ts";

let sessionToken: string | null = null;
let socket: WebSocket | null = null;
const SESSION_TOKEN_KEY = "steward.session-token";

type SessionStorage = Pick<Storage, "getItem" | "setItem">;
type ReplaceUrl = (url: string) => void;

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

export function parseServerEvent(raw: string): WsServerEvent {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Server event is not valid JSON.");
  }
  if (!isWsServerEvent(value)) {
    throw new Error("Server event payload is unsupported.");
  }
  return value;
}

function websocketUrl(token: string): string {
  const url = new URL("/ws", window.location.href);
  url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  url.search = "";
  url.searchParams.set("token", token);
  return url.toString();
}

const pacer = createPacer(applyServerEvent);

type CompositionDetailRequest = Extract<
  WsClientEvent, { type: "get_composition_detail" }
>;

export function compositionDetailRequests(
  event: WsServerEvent,
): CompositionDetailRequest[] {
  if (event.type !== "composable_catalog") return [];
  return [...new Set(event.workflows
    .filter((workflow) => workflow.kind === "composition")
    .map((workflow) => workflow.workflow_id))]
    .map((workflow_id) => ({ type: "get_composition_detail", workflow_id }));
}

function receive(raw: string): WsServerEvent | undefined {
  try {
    const event = parseServerEvent(raw);
    pacer.push(event);
    return event;
  } catch (error) {
    applyServerEvent({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
    return undefined;
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
  connection.addEventListener("message", (event) => {
    if (socket !== connection) return;
    const received = receive(String(event.data));
    if (!received) return;
    for (const request of compositionDetailRequests(received)) {
      sendClientEvent(request);
    }
  });
  connection.addEventListener("open", () => {
    if (socket === connection) {
      handleConnectionOpened();
      sendClientEvent({ type: "get_composable_catalog" });
    }
  }, { once: true });
  connection.addEventListener("error", () => {
    if (socket === connection) applyServerEvent({
      type: "error",
      message: "Connection to Steward was interrupted.",
    });
  });
  connection.addEventListener("close", () => {
    if (socket !== connection) return;
    socket = null;
    pacer.reset();
    handleConnectionClosed();
  });
  return connection;
}

export function sendClientEvent(event: WsClientEvent): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    throw new Error("Steward is not connected.");
  }
  socket.send(JSON.stringify(event));
  applyClientEvent(event);
}

export function disconnectWebSocket(): void {
  const connection = socket;
  socket = null;
  pacer.reset();
  handleConnectionClosed();
  connection?.close();
}

export function resetSessionAuthForTests(): void {
  sessionToken = null;
}
