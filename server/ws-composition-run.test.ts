import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { videoStage } from "./composition-runtime-test-helpers.ts";
import { runComposition } from "./composition-runtime.ts";
import { executePlan } from "./executor.ts";
import type { Plan } from "./plan.ts";
import { probeSystem } from "./probe.ts";
import { persistRecipe } from "./recipe-persistence.ts";
import type { CompositionRecipe, CompositionStage } from "./recipe-types.ts";
import { validateRecipe, validateSavedRecipe } from "./recipe-validation.ts";
import { loadSaved, RECIPES_DIRECTORY } from "./recipes.ts";
import { StagedInputRegistry } from "./staged-input-registry.ts";
import { writeY4m } from "./test-fixtures.ts";
import { runEngineEvent } from "./ws-engine.ts";
import type { WsServerEvent } from "./ws-events.ts";

const root = mkdtempSync(join(tmpdir(), "steward-ws-composition-run-"));
const catalog = join(root, "catalog");
const staging = new StagedInputRegistry(join(root, "staging"));
const frame = join(staging.root, "frame.y4m");
const source = join(staging.root, "source.mp4");
const fakeCodex = join(root, "codex-must-not-run");
const codexMarker = join(root, "codex-was-run");
const profile = probeSystem();

function saveStage(stage: CompositionStage): void {
  const { source_id, composition_contract: _contract, ...body } = stage;
  persistRecipe(validateRecipe({
    ...body, name: source_id,
    created_at: "2026-07-19T10:00:00.000Z",
    arch: profile.architecture,
  }), catalog);
}

function stageCopy(name: string, from = source): string {
  const path = join(staging.root, name);
  copyFileSync(from, path);
  return staging.register(path);
}

function eventsOf(events: WsServerEvent[], type: WsServerEvent["type"]) {
  return events.filter((event) => event.type === type);
}

async function withCodexTrap(run: () => Promise<void>): Promise<void> {
  const previousBinary = process.env.STEWARD_CODEX_BIN;
  rmSync(codexMarker, { force: true });
  process.env.STEWARD_CODEX_BIN = fakeCodex;
  try {
    await run();
  } finally {
    if (previousBinary === undefined) delete process.env.STEWARD_CODEX_BIN;
    else process.env.STEWARD_CODEX_BIN = previousBinary;
  }
}

beforeAll(async () => {
  mkdirSync(catalog);
  writeFileSync(fakeCodex, `#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(codexMarker)}, "invoked");
process.exit(97);
`);
  chmodSync(fakeCodex, 0o700);
  writeY4m(frame, 1);
  const fixture: Plan = {
    name: "composition-protocol-fixture",
    tool: "ffmpeg", install_cmd: null,
    commands: [[
      "ffmpeg", "-loglevel", "error", "-i", frame,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", source,
    ]],
    output_path: source,
    checks: [{ type: "plays", target: true }],
  };
  const execution = await executePlan(fixture, profile, [frame]);
  if (!execution.ok) throw new Error(execution.stderr_tail);
  saveStage(videoStage({ id: "protocol-stage-one", suffix: "one", format: "mov" }));
  saveStage(videoStage({ id: "protocol-stage-two", suffix: "two" }));
  saveStage(videoStage({ id: "protocol-stage-three", suffix: "three", format: "mkv" }));
  saveStage(videoStage({
    id: "protocol-check-failure", suffix: "check-failure",
    checks: [
      { type: "format_matches", target: "mp4" },
      { type: "streams_present", target: "video" },
      { type: "plays", target: true },
      { type: "size_under", target: 1 },
    ],
  }));
  const ocr = loadSaved(RECIPES_DIRECTORY).find(({ name }) => name === "ocr-scanned-pdf");
  if (!ocr) throw new Error("OCR fixture recipe is missing");
  persistRecipe(ocr, catalog);
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("composition WebSocket execution", () => {
  test("runs, verifies, persists, refreshes, and reports zero model calls", async () => {
    const events: WsServerEvent[] = [];
    const stagedPath = join(staging.root, "first-source.mp4");
    const stagedId = stageCopy("first-source.mp4");
    await withCodexTrap(() => runEngineEvent({
        type: "run_composition",
        name: "protocol-chain",
        workflow_ids: ["protocol-stage-one", "protocol-stage-two"],
        staged_input_id: stagedId,
      }, (event) => events.push(event), {
        recipeDirectory: catalog, profile, stagedInputs: staging,
        pendingCompositionRuns: new Map(),
      }),
    );
    expect(existsSync(codexMarker)).toBe(false);

    const saved = loadSaved(catalog).find(({ name }) => name === "protocol-chain");
    expect(saved?.kind).toBe("composition");
    expect(events.at(-1)).toMatchObject({
      type: "composition_run_complete", success: true, model_calls: 0,
    });
    const types = events.map(({ type }) => type);
    expect(types.indexOf("composition_saved")).toBeLessThan(types.indexOf("composable_catalog"));
    expect(types.indexOf("composable_catalog")).toBeLessThan(
      types.indexOf("composition_run_complete"),
    );
    expect(eventsOf(events, "composition_stage_started")).toHaveLength(2);
    const duplicateChecks = events.filter((event) =>
      event.type === "composition_check_result" && event.name === "plays"
    );
    expect(duplicateChecks).toMatchObject([
      { stage_index: 0, source_id: "protocol-stage-one", pass: true },
      { stage_index: 1, source_id: "protocol-stage-two", pass: true },
    ]);
    expect(eventsOf(events, "model_call_count")).toEqual([
      expect.objectContaining({ model_calls: 0 }),
    ]);
    expect(events).toContainEqual(expect.objectContaining({
      type: "composition_cleanup", success: true,
    }));
    expect(existsSync(stagedPath)).toBe(false);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(staging.root);
    expect(serialized).not.toContain("steward-composition-");
    expect(serialized).not.toContain("output_root");
    expect(serialized).not.toContain("token");
  });

  test("reruns a composition directly by stable ID without matching or planning", async () => {
    const events: WsServerEvent[] = [];
    await withCodexTrap(() => runEngineEvent({
        type: "run_saved_workflow",
        workflow_id: "protocol-chain",
        staged_input_id: stageCopy("fresh-source.mp4"),
      }, (event) => events.push(event), {
        recipeDirectory: catalog, profile, stagedInputs: staging,
        pendingCompositionRuns: new Map(),
      }),
    );
    expect(existsSync(codexMarker)).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({
      type: "composition_selected",
      workflow_id: "protocol-chain",
      model_calls: 0,
    }));
    expect(eventsOf(events, "recipe_matched")).toHaveLength(0);
    expect(eventsOf(events, "composition_saved")).toHaveLength(0);
    expect(eventsOf(events, "composable_catalog")).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({
      type: "composition_run_complete", success: true, model_calls: 0,
    });
  });

  test("flattens a selected composition from authoritative frozen snapshots", async () => {
    let captured: CompositionRecipe | undefined;
    const fakeRun: typeof runComposition = async (value, input) => {
      const saved = validateSavedRecipe(value);
      if (saved.kind !== "composition") throw new Error("expected composition");
      captured = saved;
      return {
        composition_id: saved.name, success: true, output_path: input as string,
        stages: [], model_calls: 0,
      };
    };
    const events: WsServerEvent[] = [];
    await runEngineEvent({
      type: "run_composition",
      name: "nested-selection-chain",
      workflow_ids: ["protocol-chain", "protocol-stage-three"],
      staged_input_id: stageCopy("nested-source.mp4"),
    }, (event) => events.push(event), {
      recipeDirectory: catalog, profile, stagedInputs: staging,
      pendingCompositionRuns: new Map(),
      compositionServices: { run: { run: fakeRun } },
    });
    expect(captured?.stages.map(({ source_id }) => source_id)).toEqual([
      "protocol-stage-one", "protocol-stage-two", "protocol-stage-three",
    ]);
    expect(JSON.stringify(captured?.stages)).not.toContain("\"stages\"");
    expect(events.at(-1)).toMatchObject({ success: true, model_calls: 0 });
  });

  test("rejects unknown, duplicate, incompatible, invalid, and unstaged selections", async () => {
    const cases = [
      {
        name: "unknown-chain",
        ids: ["protocol-stage-one", "absent-stage"],
        staged_input_id: stageCopy("unknown-source.mp4"),
      },
      {
        name: "duplicate-chain",
        ids: ["protocol-stage-one", "protocol-stage-one"],
        staged_input_id: stageCopy("duplicate-source.mp4"),
      },
      {
        name: "incompatible-chain",
        ids: ["protocol-stage-one", "ocr-scanned-pdf"],
        staged_input_id: stageCopy("incompatible-source.mp4"),
      },
      {
        name: "invalid-count-chain",
        ids: ["protocol-stage-one", "protocol-stage-three", "protocol-check-failure",
          "protocol-stage-two", "protocol-stage-one", "protocol-stage-three",
          "protocol-stage-two", "protocol-check-failure", "protocol-stage-one"],
        staged_input_id: stageCopy("invalid-count-source.mp4"),
      },
      {
        name: "unstaged-chain",
        ids: ["protocol-stage-one", "protocol-stage-two"],
        staged_input_id: "00000000-0000-4000-8000-000000000000",
      },
    ];
    for (const candidate of cases) {
      const events: WsServerEvent[] = [];
      await runEngineEvent({
        type: "run_composition",
        name: candidate.name,
        workflow_ids: candidate.ids,
        staged_input_id: candidate.staged_input_id,
      }, (event) => events.push(event), {
        recipeDirectory: catalog, profile, stagedInputs: staging,
        pendingCompositionRuns: new Map(),
      });
      expect(events.at(-1)).toMatchObject({
        type: "composition_run_complete", success: false, model_calls: 0,
      });
      expect(existsSync(join(catalog, `${candidate.name}.json`))).toBe(false);
      expect(eventsOf(events, "composition_stage_started")).toHaveLength(0);
    }
  });

  test("command and verification failures stop later stages and never save", async () => {
    const corrupt = join(staging.root, "corrupt.mp4");
    writeFileSync(corrupt, "not media");
    const verificationPath = join(staging.root, "verification-source.mp4");
    const scenarios = [
      {
        name: "protocol-command-failure",
        ids: ["protocol-stage-one", "protocol-stage-two"],
        staged_input_id: staging.register(corrupt),
        input_path: corrupt,
        verification: false,
      },
      {
        name: "protocol-verification-failure",
        ids: ["protocol-check-failure", "protocol-stage-two"],
        staged_input_id: stageCopy("verification-source.mp4"),
        input_path: verificationPath,
        verification: true,
      },
    ];
    for (const scenario of scenarios) {
      const events: WsServerEvent[] = [];
      await runEngineEvent({
        type: "run_composition",
        name: scenario.name,
        workflow_ids: scenario.ids,
        staged_input_id: scenario.staged_input_id,
      }, (event) => events.push(event), {
        recipeDirectory: catalog, profile, stagedInputs: staging,
        pendingCompositionRuns: new Map(),
      });
      expect(eventsOf(events, "composition_stage_started")).toHaveLength(1);
      expect(eventsOf(events, "composition_cleanup")).toEqual([
        expect.objectContaining({ success: true }),
      ]);
      expect(eventsOf(events, "composition_saved")).toHaveLength(0);
      expect(existsSync(join(catalog, `${scenario.name}.json`))).toBe(false);
      expect(existsSync(scenario.input_path)).toBe(false);
      expect(events.at(-1)).toMatchObject({ success: false, model_calls: 0 });
      if (scenario.verification) {
        expect(events.some((event) =>
          event.type === "composition_check_result" && !event.pass
        )).toBe(true);
      } else {
        expect(eventsOf(events, "composition_verification_started")).toHaveLength(0);
      }
    }
  });
});
