import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLocalServer } from "./local-server.ts";

const root = mkdtempSync(join(tmpdir(), "steward-ui-server-"));
writeFileSync(join(root, "index.html"), "<!doctype html><title>Steward</title><main>ready</main>");
writeFileSync(join(root, "asset.txt"), "static asset");
symlinkSync("/etc/hosts", join(root, "escape.txt"));
const running = startLocalServer({ staticRoot: root });

beforeAll(() => expect(running.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/));
afterAll(() => {
  running.server.stop(true);
  rmSync(root, { recursive: true, force: true });
});

describe("local UI server", () => {
  test("requires the session token on every HTTP request", async () => {
    expect((await fetch(`${running.origin}/`)).status).toBe(401);
    expect((await fetch(`${running.origin}/?token=wrong`)).status).toBe(401);
    const authorized = await fetch(running.url);
    expect(authorized.status).toBe(200);
    expect(await authorized.text()).toContain("<main>ready</main>");
    const cookie = authorized.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toStartWith("steward_token=");
    expect((await fetch(`${running.origin}/asset.txt`, {
      headers: { cookie: cookie! },
    })).status).toBe(200);
    expect((await fetch(`${running.origin}/?token=wrong`, {
      headers: { cookie: cookie! },
    })).status).toBe(401);
    expect((await fetch(`${running.origin}/escape.txt?token=${running.token}`)).status).toBe(404);
  });

  test("rejects an unauthenticated WebSocket upgrade and echoes an authenticated one", async () => {
    expect((await fetch(`${running.origin}/ws`)).status).toBe(401);
    expect((await fetch(`${running.origin}/ws?token=${running.token}`)).status).toBe(426);
    const wsUrl = `${running.origin.replace("http://", "ws://")}/ws?token=${running.token}`;
    const echoed = await new Promise<string>((resolveMessage, reject) => {
      const socket = new WebSocket(wsUrl);
      const timeout = setTimeout(() => reject(new Error("WebSocket echo timed out")), 2_000);
      socket.addEventListener("open", () => socket.send("steward-echo"));
      socket.addEventListener("message", (event) => {
        clearTimeout(timeout);
        socket.close();
        resolveMessage(String(event.data));
      });
      socket.addEventListener("error", () => reject(new Error("WebSocket echo failed")));
    });
    expect(echoed).toBe("steward-echo");
  });
});
