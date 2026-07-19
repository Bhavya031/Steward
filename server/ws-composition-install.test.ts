import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildComposition } from "./composition-builder.ts";
import {
  compositionRequirements, installCompositionRequirements,
  type CompositionInstallationDependencies, type CompositionRequirements,
} from "./composition-installation.ts";
import { runComposition } from "./composition-runtime.ts";
import type { SystemProfile } from "./probe.ts";
import { probeSystem } from "./probe.ts";
import { RECIPES_DIRECTORY } from "./recipes.ts";
import { StagedInputRegistry } from "./staged-input-registry.ts";
import { runEngineEvent } from "./ws-engine.ts";
import type { PendingCompositionInstall } from "./ws-composition-install.ts";
import type { WsServerEvent } from "./ws-events.ts";

const root = mkdtempSync(join(tmpdir(), "steward-composition-install-"));
const catalog = join(root, "catalog");
const staging = new StagedInputRegistry(join(root, "staging"));
const baseProfile = probeSystem();
const workflowIds = ["convert-media-to-mp4", "transcribe-video-to-srt"];
const resourceId = "whisper-large-v3-turbo" as const;

function profileWith(installed: string[]): SystemProfile {
  return {
    ...baseProfile,
    tools: baseProfile.tools.map((tool) => ({
      ...tool,
      installed: installed.includes(tool.name),
      binary: installed.includes(tool.name) ? tool.binary ?? `/managed/${tool.name}` : null,
    })),
  };
}

function staged(name: string): string {
  const path = join(staging.root, name);
  writeFileSync(path, "server staged fixture");
  return staging.register(path);
}

function eventCount(events: WsServerEvent[], type: WsServerEvent["type"]): number {
  return events.filter((event) => event.type === type).length;
}

beforeAll(() => {
  mkdirSync(catalog);
  for (const name of workflowIds) {
    copyFileSync(join(RECIPES_DIRECTORY, `${name}.json`), join(catalog, `${name}.json`));
  }
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("composition installation and exact resume", () => {
  test("preflights and deduplicates every declared tool and resource", async () => {
    const composition = buildComposition({
      name: "install-preflight-chain",
      workflow_ids: workflowIds,
      arch: baseProfile.architecture,
    }, catalog);
    const requirements = await compositionRequirements(
      composition,
      profileWith([]),
      {
        executeTool: async () => { throw new Error("not installing during preflight"); },
        installResource: async () => { throw new Error("not installing during preflight"); },
        probe: () => profileWith([]),
        missingResources: async (ids) => [...ids],
      },
    );
    expect(requirements.tools).toEqual([
      {
        tool: "ffmpeg",
        provides: ["ffmpeg"],
        command: ["brew", "install", "ffmpeg"],
      },
      {
        tool: "whisper-cli",
        provides: ["whisper-cli"],
        command: ["brew", "install", "whisper-cpp"],
      },
    ]);
    expect(requirements.resources).toEqual([resourceId]);
  });

  test("installs tools and resources sequentially", async () => {
    const order: string[] = [];
    let probeCount = 0;
    const requirements: CompositionRequirements = {
      tools: [
        {
          tool: "ffmpeg", provides: ["ffmpeg"],
          command: ["brew", "install", "ffmpeg"],
        },
        {
          tool: "whisper-cli", provides: ["whisper-cli"],
          command: ["brew", "install", "whisper-cpp"],
        },
      ],
      resources: [resourceId],
    };
    const dependencies: CompositionInstallationDependencies = {
      executeTool: async (tool) => {
        order.push(`tool:${tool}`);
        return {
          ok: true, exit_code: 0, timed_out: false, duration_ms: 1,
          stdout_tail: "", stderr_tail: "",
        };
      },
      probe: () => {
        probeCount += 1;
        return profileWith(probeCount === 1 ? ["ffmpeg"] : ["ffmpeg", "whisper-cli"]);
      },
      installResource: async (id, progress) => {
        order.push(`resource:${id}`);
        progress?.({ id, received: 10, total: 10 });
        return join(root, "model.bin");
      },
      missingResources: async (ids) => ids,
    };
    const progress: number[] = [];
    await installCompositionRequirements(profileWith([]), requirements, {
      onResourceProgress: ({ received }) => progress.push(received),
    }, dependencies);
    expect(order).toEqual([
      "tool:ffmpeg", "tool:whisper-cli", `resource:${resourceId}`,
    ]);
    expect(progress).toEqual([10]);
  });

  test("requests one approval, reports progress, and resumes the exact frozen chain", async () => {
    const pending = new Map<string, PendingCompositionInstall>();
    const events: WsServerEvent[] = [];
    let runCount = 0;
    let frozenIds: string[] = [];
    const fakeRun: typeof runComposition = async (value, input) => {
      const composition = value as { name: string; stages: Array<{ source_id: string }> };
      runCount += 1;
      frozenIds = composition.stages.map(({ source_id }) => source_id);
      return {
        composition_id: composition.name, success: true,
        output_path: input as string, stages: [], model_calls: 0,
      };
    };
    const requirements: CompositionRequirements = {
      tools: [
        {
          tool: "ffmpeg", provides: ["ffmpeg"],
          command: ["brew", "install", "ffmpeg"],
        },
        {
          tool: "whisper-cli", provides: ["whisper-cli"],
          command: ["brew", "install", "whisper-cpp"],
        },
      ],
      resources: [resourceId],
    };
    const inputPath = join(staging.root, "install-input.mp4");
    await runEngineEvent({
      type: "run_composition",
      name: "install-resume-chain",
      workflow_ids: workflowIds,
      staged_input_id: staged("install-input.mp4"),
    }, (event) => events.push(event), {
      recipeDirectory: catalog, profile: profileWith([]), stagedInputs: staging,
      pendingCompositionRuns: pending,
      compositionServices: {
        requirements: async () => structuredClone(requirements),
        install: async (profile, _requirements, callbacks) => {
          callbacks?.onResourceProgress?.({ id: resourceId, received: 4, total: 10 });
          callbacks?.onResourceProgress?.({ id: resourceId, received: 10, total: 10 });
          return { ...profile, tools: profileWith(["ffmpeg", "whisper-cli"]).tools };
        },
        run: { run: fakeRun },
      },
    });
    expect(runCount).toBe(0);
    const approval = events.find((event) => event.type === "composition_install_required");
    expect(approval).toMatchObject({
      tools: [
        { tools: ["ffmpeg"], command: ["brew", "install", "ffmpeg"] },
        { tools: ["whisper-cli"], command: ["brew", "install", "whisper-cpp"] },
      ],
      resources: [{ id: resourceId }],
    });
    expect(eventCount(events, "composition_install_required")).toBe(1);
    const runId = approval && "run_id" in approval ? approval.run_id : "";
    await runEngineEvent(
      { type: "confirm_install", run_id: runId, confirm: true },
      (event) => events.push(event),
      {
        recipeDirectory: catalog, stagedInputs: staging,
        pendingCompositionRuns: pending,
        compositionServices: {
          requirements: async () => structuredClone(requirements),
          install: async (profile, _requirements, callbacks) => {
            callbacks?.onResourceProgress?.({ id: resourceId, received: 4, total: 10 });
            callbacks?.onResourceProgress?.({ id: resourceId, received: 10, total: 10 });
            return { ...profile, tools: profileWith(["ffmpeg", "whisper-cli"]).tools };
          },
          run: { run: fakeRun },
        },
      },
    );
    expect(runCount).toBe(1);
    expect(frozenIds).toEqual(workflowIds);
    expect(eventCount(events, "composition_install_progress")).toBe(2);
    expect(events.at(-1)).toMatchObject({
      type: "composition_run_complete", success: true, model_calls: 0,
    });
    expect(existsSync(join(catalog, "install-resume-chain.json"))).toBe(true);
    expect(existsSync(inputPath)).toBe(false);
    expect(events.filter((event) => event.type === "model_call_count"))
      .toEqual([expect.objectContaining({ model_calls: 0 })]);
  });

  test("approval denial runs and saves nothing", async () => {
    const pending = new Map<string, PendingCompositionInstall>();
    const events: WsServerEvent[] = [];
    let runs = 0;
    const inputPath = join(staging.root, "denied-input.mp4");
    await runEngineEvent({
      type: "run_composition",
      name: "denied-install-chain",
      workflow_ids: workflowIds,
      staged_input_id: staged("denied-input.mp4"),
    }, (event) => events.push(event), {
      recipeDirectory: catalog, profile: profileWith([]), stagedInputs: staging,
      pendingCompositionRuns: pending,
      compositionServices: {
        requirements: async () => ({
          tools: [], resources: [resourceId],
        }),
        run: { run: async () => { runs += 1; throw new Error("must not run"); } },
      },
    });
    const approval = events.find((event) => event.type === "composition_install_required");
    const runId = approval && "run_id" in approval ? approval.run_id : "";
    await runEngineEvent(
      { type: "deny_install", run_id: runId },
      (event) => events.push(event),
      { pendingCompositionRuns: pending },
    );
    expect(runs).toBe(0);
    expect(pending.size).toBe(0);
    expect(eventCount(events, "composition_install_denied")).toBe(1);
    expect(existsSync(join(catalog, "denied-install-chain.json"))).toBe(false);
    expect(existsSync(inputPath)).toBe(false);
    expect(events.at(-1)).toMatchObject({ success: false, model_calls: 0 });
  });

  test("checksum failure aborts resume without running or saving", async () => {
    const pending = new Map<string, PendingCompositionInstall>();
    const events: WsServerEvent[] = [];
    let runs = 0;
    const common = {
      recipeDirectory: catalog,
      stagedInputs: staging,
      pendingCompositionRuns: pending,
      compositionServices: {
        requirements: async () => ({ tools: [], resources: [resourceId] }),
        install: async () => { throw new Error("model SHA-256 mismatch"); },
        run: { run: async () => { runs += 1; throw new Error("must not run"); } },
      },
    };
    const inputPath = join(staging.root, "checksum-input.mp4");
    await runEngineEvent({
      type: "run_composition",
      name: "checksum-failure-chain",
      workflow_ids: workflowIds,
      staged_input_id: staged("checksum-input.mp4"),
    }, (event) => events.push(event), {
      ...common, profile: profileWith([]),
    });
    const approval = events.find((event) => event.type === "composition_install_required");
    const runId = approval && "run_id" in approval ? approval.run_id : "";
    await runEngineEvent(
      { type: "confirm_install", run_id: runId, confirm: true },
      (event) => events.push(event),
      common,
    );
    expect(runs).toBe(0);
    expect(pending.size).toBe(0);
    expect(events).toContainEqual(expect.objectContaining({
      type: "composition_error", message: "model SHA-256 mismatch",
    }));
    expect(existsSync(join(catalog, "checksum-failure-chain.json"))).toBe(false);
    expect(existsSync(inputPath)).toBe(false);
    expect(events.at(-1)).toMatchObject({ success: false, model_calls: 0 });
  });
});
