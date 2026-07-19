import { existsSync, mkdtempSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import type { ServerWebSocket } from "bun";
import { STAGE_INPUT_PATH, stageInput } from "./input-staging.ts";
import { createSessionToken, requestHasSessionToken, sessionCookie } from "./security.ts";
import { StagedInputRegistry } from "./staged-input-registry.ts";
import { userFacingMessage } from "./user-facing.ts";

export interface SocketData { authenticated: true }
export type LocalSocket = ServerWebSocket<SocketData>;
export interface LocalServerOptions {
  staticRoot?: string;
  stagingRoot?: string;
  stagedInputs?: StagedInputRegistry;
  openBrowser?: boolean;
  onWebSocketOpen?: (socket: LocalSocket) => void | Promise<void>;
  onWebSocketMessage?: (socket: LocalSocket, message: string) => void | Promise<void>;
  onWebSocketClose?: (
    socket: LocalSocket, code: number, reason: string,
  ) => void | Promise<void>;
}

function inside(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

function staticFile(root: string, pathname: string): string | null {
  let relative: string;
  try {
    relative = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (relative.includes("\0") || relative.includes("\\")) return null;
  relative = relative === "/" ? "index.html" : relative.replace(/^\/+/, "");
  const candidate = resolve(root, relative);
  if (!inside(root, candidate) || !existsSync(candidate)) return null;
  const real = realpathSync(candidate);
  return inside(root, real) && statSync(real).isFile() ? real : null;
}

function launchBrowser(url: string): void {
  const child = Bun.spawn(["/usr/bin/open", url], { stdout: "ignore", stderr: "ignore" });
  void child.exited;
}

export function startLocalServer(options: LocalServerOptions = {}) {
  const requestedRoot = options.staticRoot ?? resolve(import.meta.dir, "..", "ui", "dist");
  if (!existsSync(requestedRoot)) throw new Error(`UI build is missing: ${requestedRoot}`);
  const staticRoot = realpathSync(requestedRoot);
  const requestedStagingRoot = options.stagingRoot ?? options.stagedInputs?.root ??
    mkdtempSync(resolve(tmpdir(), "steward-inputs-"));
  mkdirSync(requestedStagingRoot, { recursive: true, mode: 0o700 });
  const stagingRoot = realpathSync(requestedStagingRoot);
  const stagedInputs = options.stagedInputs ?? new StagedInputRegistry(stagingRoot);
  if (stagedInputs.root !== stagingRoot) {
    throw new Error("staged-input registry does not match the server staging root");
  }
  const token = createSessionToken();
  const server = Bun.serve<SocketData, {}>({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request, bunServer) {
      if (!requestHasSessionToken(request, token)) {
        return new Response("Unauthorized", { status: 401 });
      }
      const url = new URL(request.url);
      if (url.pathname === "/ws") {
        if (bunServer.upgrade(request, { data: { authenticated: true } })) return;
        return new Response("WebSocket upgrade required", { status: 426 });
      }
      if (url.pathname === STAGE_INPUT_PATH) {
        if (request.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }
        return stageInput(request, stagingRoot, stagedInputs);
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method not allowed", { status: 405 });
      }
      const path = staticFile(staticRoot, url.pathname);
      if (!path) return new Response("Not found", { status: 404 });
      const headers = new Headers({
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      if (url.searchParams.has("token")) headers.set("Set-Cookie", sessionCookie(token));
      return new Response(Bun.file(path), { headers });
    },
    websocket: {
      open(socket) {
        void Promise.resolve(options.onWebSocketOpen?.(socket)).catch((error) => {
          console.error(`WebSocket startup failed: ${userFacingMessage(error)}`);
          socket.close(1011, "Internal startup failure");
        });
      },
      message(socket, message) {
        if (!options.onWebSocketMessage) {
          socket.send(message);
          return;
        }
        const text = typeof message === "string" ? message : message.toString("utf8");
        void Promise.resolve(options.onWebSocketMessage(socket, text)).catch((error) => {
          console.error(`WebSocket handler failed: ${userFacingMessage(error)}`);
          socket.close(1011, "Internal bridge failure");
        });
      },
      close(socket, code, reason) {
        void Promise.resolve(options.onWebSocketClose?.(socket, code, reason))
          .catch((error) => {
            console.error(`WebSocket cleanup failed: ${userFacingMessage(error)}`);
          });
      },
    },
  });
  const origin = `http://127.0.0.1:${server.port}`;
  const url = `${origin}/?token=${token}`;
  if (options.openBrowser) launchBrowser(url);
  return { server, token, origin, url, stagingRoot, stagedInputs };
}
