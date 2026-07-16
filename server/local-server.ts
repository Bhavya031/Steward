import { existsSync, realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { createSessionToken, requestHasSessionToken, sessionCookie } from "./security.ts";

interface SocketData { authenticated: true }
export interface LocalServerOptions {
  staticRoot?: string;
  openBrowser?: boolean;
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
  const token = createSessionToken();
  const server = Bun.serve<SocketData, {}>({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, bunServer) {
      if (!requestHasSessionToken(request, token)) {
        return new Response("Unauthorized", { status: 401 });
      }
      const url = new URL(request.url);
      if (url.pathname === "/ws") {
        if (bunServer.upgrade(request, { data: { authenticated: true } })) return;
        return new Response("WebSocket upgrade required", { status: 426 });
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
      message(socket, message) { socket.send(message); },
    },
  });
  const origin = `http://127.0.0.1:${server.port}`;
  const url = `${origin}/?token=${token}`;
  if (options.openBrowser) launchBrowser(url);
  return { server, token, origin, url };
}
