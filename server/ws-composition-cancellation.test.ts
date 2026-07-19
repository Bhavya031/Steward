import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeSystem } from "./probe.ts";
import { RECIPES_DIRECTORY } from "./recipes.ts";
import { StagedInputRegistry } from "./staged-input-registry.ts";
import { createWsBridge, type WsSender } from "./ws-bridge.ts";
import type { WsServerEvent } from "./ws-events.ts";

const root = mkdtempSync(join(tmpdir(), "steward-ws-cancel-"));
const catalog = join(root, "catalog");
const workflowIds = ["convert-media-to-mp4", "transcribe-video-to-srt"];
const profile = probeSystem();

class Socket implements WsSender {
  events: WsServerEvent[] = [];
  send(message: string): void {
    this.events.push(JSON.parse(message) as WsServerEvent);
  }
}

beforeAll(() => {
  mkdirSync(catalog);
  for (const id of workflowIds) {
    copyFileSync(join(RECIPES_DIRECTORY, `${id}.json`), join(catalog, `${id}.json`));
  }
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

function staged(registry: StagedInputRegistry, name: string) {
  const path = join(registry.root, name);
  writeFileSync(path, "private staged input");
  return { path, id: registry.register(path) };
}

function request(name: string, id: string): string {
  return JSON.stringify({
    type: "run_composition", name, workflow_ids: workflowIds, staged_input_id: id,
  });
}

function approvalRunId(socket: Socket): string {
  const event = socket.events.find(({ type }) => type === "composition_install_required");
  if (!event || event.type !== "composition_install_required") throw new Error("approval missing");
  return event.run_id;
}

describe("per-socket composition cancellation", () => {
  test("disconnect while awaiting approval clears resume state and deletes input once", async () => {
    let removals = 0;
    let installs = 0;
    const registry = new StagedInputRegistry(join(root, "approval-staging"), (path) => {
      removals += 1;
      rmSync(path);
    });
    const input = staged(registry, "approval.mov");
    const socket = new Socket();
    const bridge = createWsBridge({
      stagedInputs: registry, recipeDirectory: catalog, profile,
      compositionServices: {
        requirements: async () => ({
          tools: [], resources: ["whisper-large-v3-turbo"],
        }),
        install: async (current) => {
          installs += 1;
          return current;
        },
      },
    });
    await bridge(socket, request("disconnect-approval", input.id));
    const runId = approvalRunId(socket);
    const emitted = socket.events.length;
    bridge.close(socket);
    bridge.close(socket);
    expect(existsSync(input.path)).toBe(false);
    expect(removals).toBe(1);
    expect(socket.events).toHaveLength(emitted);
    await bridge(socket, JSON.stringify({ type: "confirm_install", run_id: runId, confirm: true }));
    expect(installs).toBe(0);
    expect(socket.events.some(({ type }) => type === "composition_install_complete")).toBe(false);
  });

  test("disconnect during installation aborts resume and saves nothing", async () => {
    const registry = new StagedInputRegistry(join(root, "install-staging"));
    const input = staged(registry, "install.mov");
    const socket = new Socket();
    let notifyStarted: (() => void) | undefined;
    const installing = new Promise<void>((resolve) => { notifyStarted = resolve; });
    const bridge = createWsBridge({
      stagedInputs: registry, recipeDirectory: catalog, profile,
      compositionServices: {
        requirements: async () => ({
          tools: [], resources: ["whisper-large-v3-turbo"],
        }),
        install: async (_current, _requirements, callbacks) => {
          if (!callbacks) throw new Error("installation callbacks are required");
          const requiredCallbacks = callbacks;
          if (!notifyStarted) throw new Error("installation start observer is unavailable");
          notifyStarted();
          await new Promise<void>((_resolve, reject) => {
            requiredCallbacks.signal?.addEventListener(
              "abort", () => reject(requiredCallbacks.signal?.reason), { once: true },
            );
          });
          throw new Error("unreachable");
        },
      },
    });
    await bridge(socket, request("disconnect-install", input.id));
    const confirmation = bridge(socket, JSON.stringify({
      type: "confirm_install", run_id: approvalRunId(socket), confirm: true,
    }));
    await installing;
    bridge.close(socket);
    await confirmation;
    expect(existsSync(input.path)).toBe(false);
    expect(existsSync(join(catalog, "disconnect-install.json"))).toBe(false);
    expect(socket.events.some(({ type }) => type === "composition_saved")).toBe(false);
  });

  test("disconnect during execution propagates abort and prevents persistence", async () => {
    const registry = new StagedInputRegistry(join(root, "execution-staging"));
    const input = staged(registry, "execution.mov");
    const socket = new Socket();
    const marker = join(root, "execution-started");
    const pidFile = join(root, "execution-child.pid");
    const binary = join(root, "composition-ffmpeg-fixture");
    writeFileSync(
      binary,
      `#!/bin/sh\necho $$ > '${pidFile}'\ntouch '${marker}'\nwhile :; do :; done\n`,
    );
    chmodSync(binary, 0o700);
    const executionProfile = {
      ...profile,
      tools: profile.tools.map((tool) => tool.name === "ffmpeg"
        ? { ...tool, installed: true, binary }
        : tool),
    };
    const rootsBefore = readdirSync(tmpdir()).filter((name) =>
      name.startsWith("steward-composition-")
    ).sort();
    const bridge = createWsBridge({
      stagedInputs: registry, recipeDirectory: catalog, profile: executionProfile,
      compositionServices: {
        requirements: async () => ({ tools: [], resources: [] }),
      },
    });
    const running = bridge(socket, request("disconnect-execution", input.id));
    for (let attempt = 0; attempt < 200 && !existsSync(marker); attempt += 1) {
      await Bun.sleep(5);
    }
    expect(existsSync(marker)).toBe(true);
    bridge.close(socket);
    await running;
    const pid = Number(readFileSync(pidFile, "utf8").trim());
    expect(() => process.kill(pid, 0)).toThrow();
    expect(existsSync(input.path)).toBe(false);
    expect(existsSync(join(catalog, "disconnect-execution.json"))).toBe(false);
    expect(socket.events.filter(({ type }) => type === "composition_stage_started")).toHaveLength(1);
    expect(readdirSync(tmpdir()).filter((name) =>
      name.startsWith("steward-composition-")
    ).sort()).toEqual(rootsBefore);
  });

  test("a disconnect after verified execution is authoritative before persistence", async () => {
    const registry = new StagedInputRegistry(join(root, "late-staging"));
    const input = staged(registry, "late.mov");
    const socket = new Socket();
    let bridge: ReturnType<typeof createWsBridge>;
    let persisted = 0;
    bridge = createWsBridge({
      stagedInputs: registry, recipeDirectory: catalog, profile,
      compositionServices: {
        requirements: async () => ({ tools: [], resources: [] }),
        run: {
          run: async (value, path) => {
            bridge.close(socket);
            return {
              composition_id: (value as { name: string }).name,
              success: true, output_path: path as string, stages: [], model_calls: 0,
            };
          },
          persist: (value) => {
            persisted += 1;
            return value;
          },
        },
      },
    });
    await bridge(socket, request("disconnect-before-save", input.id));
    expect(persisted).toBe(0);
    expect(existsSync(input.path)).toBe(false);
    expect(existsSync(join(catalog, "disconnect-before-save.json"))).toBe(false);
  });

  test("successful execution deletes its staged input before persistence", async () => {
    const registry = new StagedInputRegistry(join(root, "success-staging"));
    const input = staged(registry, "success.mov");
    const socket = new Socket();
    let absentAtPersistence = false;
    const bridge = createWsBridge({
      stagedInputs: registry, recipeDirectory: catalog, profile,
      compositionServices: {
        requirements: async () => ({ tools: [], resources: [] }),
        run: {
          run: async (value, path) => ({
            composition_id: (value as { name: string }).name,
            success: true, output_path: path as string, stages: [], model_calls: 0,
          }),
          persist: (value) => {
            absentAtPersistence = !existsSync(input.path);
            return value;
          },
        },
      },
    });
    await bridge(socket, request("cleanup-before-save", input.id));
    expect(absentAtPersistence).toBe(true);
    expect(existsSync(input.path)).toBe(false);
    expect(socket.events.at(-1)).toMatchObject({
      type: "composition_run_complete", success: true,
    });
  });

  test("thrown execution errors delete input and cleanup failure prevents success", async () => {
    const thrownRegistry = new StagedInputRegistry(join(root, "thrown-staging"));
    const thrownInput = staged(thrownRegistry, "thrown.mov");
    const thrownSocket = new Socket();
    const thrownBridge = createWsBridge({
      stagedInputs: thrownRegistry, recipeDirectory: catalog, profile,
      compositionServices: {
        requirements: async () => ({ tools: [], resources: [] }),
        run: { run: async () => { throw new Error("runtime exploded"); } },
      },
    });
    await thrownBridge(thrownSocket, request("thrown-cleanup", thrownInput.id));
    expect(existsSync(thrownInput.path)).toBe(false);
    expect(thrownSocket.events.at(-1)).toMatchObject({ success: false });

    let attempts = 0;
    const retryRegistry = new StagedInputRegistry(join(root, "retry-staging"), (path) => {
      attempts += 1;
      if (attempts === 1) throw new Error("unlink refused");
      rmSync(path);
    });
    const retryInput = staged(retryRegistry, "retry.mov");
    const retrySocket = new Socket();
    let persisted = 0;
    const retryBridge = createWsBridge({
      stagedInputs: retryRegistry, recipeDirectory: catalog, profile,
      compositionServices: {
        requirements: async () => ({ tools: [], resources: [] }),
        run: {
          run: async (value, path) => ({
            composition_id: (value as { name: string }).name,
            success: true, output_path: path as string, stages: [], model_calls: 0,
          }),
          persist: (value) => {
            persisted += 1;
            return value;
          },
        },
      },
    });
    await retryBridge(retrySocket, request("cleanup-failure", retryInput.id));
    expect(persisted).toBe(0);
    expect(existsSync(retryInput.path)).toBe(true);
    expect(retrySocket.events.at(-1)).toMatchObject({ success: false });
    retryBridge.close(retrySocket);
    expect(attempts).toBe(2);
    expect(existsSync(retryInput.path)).toBe(false);
  });

  test("approval state remains isolated to its originating socket", async () => {
    const registry = new StagedInputRegistry(join(root, "isolation-staging"));
    const input = staged(registry, "isolation.mov");
    const owner = new Socket();
    const other = new Socket();
    let installs = 0;
    const bridge = createWsBridge({
      stagedInputs: registry, recipeDirectory: catalog, profile,
      compositionServices: {
        requirements: async () => ({
          tools: [], resources: ["whisper-large-v3-turbo"],
        }),
        install: async (current) => {
          installs += 1;
          return current;
        },
        run: {
          run: async (value, path) => ({
            composition_id: (value as { name: string }).name,
            success: true, output_path: path as string, stages: [], model_calls: 0,
          }),
        },
      },
    });
    await bridge(owner, request("isolated-approval", input.id));
    const confirmation = JSON.stringify({
      type: "confirm_install", run_id: approvalRunId(owner), confirm: true,
    });
    await bridge(other, confirmation);
    expect(installs).toBe(0);
    expect(existsSync(input.path)).toBe(true);
    await bridge(owner, confirmation);
    expect(installs).toBe(1);
    expect(existsSync(input.path)).toBe(false);
  });
});
