import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { startLocalServer } from "./local-server.ts";

const root = mkdtempSync(join(tmpdir(), "steward-ui-server-"));
const stagingRoot = mkdtempSync(join(tmpdir(), "steward-ui-inputs-"));
writeFileSync(join(root, "index.html"), "<!doctype html><title>Steward</title><main>ready</main>");
writeFileSync(join(root, "asset.txt"), "static asset");
symlinkSync("/etc/hosts", join(root, "escape.txt"));
const running = startLocalServer({ staticRoot: root, stagingRoot });

beforeAll(() => expect(running.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/));
afterAll(() => {
  running.server.stop(true);
  rmSync(root, { recursive: true, force: true });
  rmSync(stagingRoot, { recursive: true, force: true });
});

function stage(filename: string, body: string, token = running.token): Promise<Response> {
  return fetch(`${running.origin}/api/stage-input?token=${token}`, {
    method: "POST",
    headers: { "X-Steward-Filename": encodeURIComponent(filename) },
    body,
  });
}

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

  test("routes authenticated WebSocket closure to server-owned cleanup", async () => {
    let closed!: (value: { code: number; reason: string }) => void;
    const observed = new Promise<{ code: number; reason: string }>((resolve) => {
      closed = resolve;
    });
    const closeServer = startLocalServer({
      staticRoot: root,
      onWebSocketClose: (_socket, code, reason) => closed({ code, reason }),
    });
    try {
      const wsUrl = `${closeServer.origin.replace("http://", "ws://")}/ws?token=${closeServer.token}`;
      const socket = new WebSocket(wsUrl);
      await new Promise<void>((resolveOpen, reject) => {
        socket.addEventListener("open", () => resolveOpen());
        socket.addEventListener("error", () => reject(new Error("WebSocket open failed")));
      });
      socket.close(1000, "finished");
      expect(await observed).toEqual({ code: 1000, reason: "finished" });
    } finally {
      closeServer.server.stop(true);
      rmSync(closeServer.stagingRoot, { recursive: true, force: true });
    }
  });

  test("rejects staging without the session token and confines accepted bytes", async () => {
    const unauthorized = await fetch(`${running.origin}/api/stage-input`, {
      method: "POST",
      headers: { "X-Steward-Filename": "private.txt" },
      body: "private",
    });
    expect(unauthorized.status).toBe(401);

    const traversal = await stage("../escape.txt", "escape");
    expect(traversal.status).toBe(400);
    expect(existsSync(join(dirname(stagingRoot), "escape.txt"))).toBe(false);

    const accepted = await stage("clip one.mov", "local bytes");
    expect(accepted.status).toBe(201);
    const result = await accepted.json() as { path: string; staged_input_id: string };
    expect(dirname(result.path)).toBe(realpathSync(stagingRoot));
    expect(readFileSync(result.path, "utf8")).toBe("local bytes");
    expect(running.stagedInputs.has(result.staged_input_id)).toBe(true);
  });

  test("uses a unique exclusive path for repeated staged filenames", async () => {
    const first = await stage("same.pdf", "first");
    const second = await stage("same.pdf", "second");
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstResult = await first.json() as { path: string; staged_input_id: string };
    const secondResult = await second.json() as { path: string; staged_input_id: string };
    const firstPath = firstResult.path;
    const secondPath = secondResult.path;
    expect(firstPath).not.toBe(secondPath);
    expect(firstResult.staged_input_id).not.toBe(secondResult.staged_input_id);
    expect(readFileSync(firstPath, "utf8")).toBe("first");
    expect(readFileSync(secondPath, "utf8")).toBe("second");
  });
});
