import { beforeEach, describe, expect, test } from "bun:test";
import type { WsServerEvent } from "../../../server/ws-events.ts";
import {
  captureStartupSession, compositionDetailRequests, parseServerEvent,
  resetSessionAuthForTests, sessionTokenForRequest, sessionTokenFromUrl,
} from "./ws.ts";
import { get } from "svelte/store";
import {
  applyServerEvent, compositions, resetStores,
} from "./stores.ts";

type CompositionDetailEvent = Extract<
  WsServerEvent, { type: "composition_detail" }
>;

function semanticDetailEvent(): CompositionDetailEvent {
  return {
    type: "composition_detail",
    detail: {
      workflow_id: "media-chain",
      title: "Media Chain",
      created_at: "2026-07-19T00:00:00.000Z",
      stage_count: 2,
      command_count: 2,
      contract: {
        input: {
          family: "media", accepted_formats: ["mov"], required_streams: ["video"],
        },
        output: { family: "media", format: "mp4", streams: ["video"] },
      },
      stages: [{
        stage_index: 0,
        source_id: "first-command",
        source_title: "First Command",
        tools: ["ffmpeg"],
        resources: [],
        command_templates: [["ffmpeg", "-i", "{{input_0}}", "{{input_0_dir}}/one.mp4"]],
        output_template: "{{input_0_dir}}/one.mp4",
        checks: [{
          check_id: "stage-0-check-0",
          stage_index: 0,
          check_index: 0,
          source_id: "first-command",
          name: "plays",
          target: true,
        }, {
          check_id: "stage-0-check-1",
          stage_index: 0,
          check_index: 1,
          source_id: "first-command",
          name: "plays",
          target: true,
        }],
      }, {
        stage_index: 1,
        source_id: "second-command",
        source_title: "Second Command",
        tools: ["ffmpeg"],
        resources: [],
        command_templates: [["ffmpeg", "-i", "{{input_0}}", "{{input_0_dir}}/two.mp4"]],
        output_template: "{{input_0_dir}}/two.mp4",
        checks: [{
          check_id: "stage-1-check-0",
          stage_index: 1,
          check_index: 0,
          source_id: "second-command",
          name: "plays",
          target: true,
        }],
      }],
      evidence: [],
      history: [],
    },
  };
}

function stage(
  event: CompositionDetailEvent,
  index: number,
): CompositionDetailEvent["detail"]["stages"][number] {
  const found = event.detail.stages[index];
  if (!found) throw new Error(`missing test stage ${index}`);
  return found;
}

function check(
  event: CompositionDetailEvent,
  stageIndex: number,
  checkIndex: number,
): CompositionDetailEvent["detail"]["stages"][number]["checks"][number] {
  const found = stage(event, stageIndex).checks[checkIndex];
  if (!found) throw new Error(`missing test check ${stageIndex}:${checkIndex}`);
  return found;
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe("browser WebSocket client", () => {
  beforeEach(() => resetSessionAuthForTests());
  test("takes the session token from the startup URL", () => {
    expect(sessionTokenFromUrl(new URL("http://127.0.0.1:1234/?token=session-123")))
      .toBe("session-123");
    expect(() => sessionTokenFromUrl(new URL("http://127.0.0.1:1234/")))
      .toThrow("Session token is missing");
  });

  test("captures the token once, keeps proof parameters, and removes it from the visible URL", () => {
    const storage = memoryStorage();
    const replacements: string[] = [];
    const token = captureStartupSession(
      new URL(
        "http://127.0.0.1:1234/?token=session-123&__proof_task=convert&__proof_file=%2Ftmp%2Fa.mov#result",
      ),
      storage,
      (url) => replacements.push(url),
    );
    expect(token).toBe("session-123");
    expect(sessionTokenForRequest()).toBe("session-123");
    expect(replacements).toEqual([
      "/?__proof_task=convert&__proof_file=%2Ftmp%2Fa.mov#result",
    ]);
    expect(replacements[0]).not.toContain("session-123");

    expect(captureStartupSession(
      new URL("http://127.0.0.1:1234/?__proof_task=convert"),
      storage,
      (url) => replacements.push(url),
    )).toBe("session-123");
    expect(replacements).toHaveLength(1);
  });

  test("does not let a later URL replace the captured browser-session token", () => {
    const storage = memoryStorage();
    captureStartupSession(
      new URL("http://127.0.0.1:1234/?token=session-123"),
      storage,
      () => undefined,
    );
    expect(() => captureStartupSession(
      new URL("http://127.0.0.1:1234/?token=attacker"),
      storage,
      () => undefined,
    )).toThrow("does not match");
  });

  test("accepts registered server events and rejects unknown types", () => {
    expect(parseServerEvent('{"type":"check_result","run_id":"r1","name":"plays","pass":true,"expected":"decode","actual":"ok"}'))
      .toMatchObject({ type: "check_result", name: "plays", pass: true });
    expect(parseServerEvent('{"type":"command_completed","run_id":"r1","exit_code":0,"duration_ms":417}'))
      .toMatchObject({ type: "command_completed", duration_ms: 417 });
    expect(parseServerEvent('{"type":"verification_completed","run_id":"r1","duration_ms":81}'))
      .toMatchObject({ type: "verification_completed", duration_ms: 81 });
    expect(parseServerEvent('{"type":"model_call_count","run_id":"r1","model_calls":1}'))
      .toMatchObject({ type: "model_call_count", model_calls: 1 });
    expect(parseServerEvent('{"type":"workflow_catalog","workflows":[]}'))
      .toEqual({ type: "workflow_catalog", workflows: [] });
    expect(parseServerEvent('{"type":"workflow_selected","run_id":"r1","workflow_id":"convert-media-to-mp4","model_calls":0}'))
      .toMatchObject({ type: "workflow_selected", model_calls: 0 });
    expect(() => parseServerEvent('{"type":"shelf_magic"}'))
      .toThrow("unsupported");
    expect(() => parseServerEvent("not json")).toThrow("valid JSON");
  });

  test("parses every composition protocol event type", () => {
    const events: WsServerEvent[] = [
      { type: "composable_catalog", workflows: [] },
      {
        type: "composition_detail",
        detail: {
          workflow_id: "chain",
          title: "Chain",
          created_at: "2026-07-19T00:00:00.000Z",
          stage_count: 2,
          command_count: 2,
          contract: {
            input: {
              family: "media", accepted_formats: ["mov"],
              required_streams: ["video"],
            },
            output: { family: "media", format: "mp4", streams: ["video"] },
          },
          stages: [{
            stage_index: 0,
            source_id: "one",
            source_title: "One",
            tools: ["ffmpeg"],
            resources: [],
            command_templates: [[
              "ffmpeg", "-i", "{{input_0}}", "{{input_0_dir}}/one.mp4",
            ]],
            output_template: "{{input_0_dir}}/one.mp4",
            checks: [{
              check_id: "stage-0-check-0",
              stage_index: 0,
              check_index: 0,
              source_id: "one",
              name: "plays",
              target: true,
            }],
          }, {
            stage_index: 1,
            source_id: "two",
            source_title: "Two",
            tools: ["ffmpeg"],
            resources: [],
            command_templates: [[
              "ffmpeg", "-i", "{{input_0}}", "{{input_0_dir}}/two.mp4",
            ]],
            output_template: "{{input_0_dir}}/two.mp4",
            checks: [{
              check_id: "stage-1-check-0",
              stage_index: 1,
              check_index: 0,
              source_id: "two",
              name: "plays",
              target: true,
            }],
          }],
          evidence: [],
          history: [],
        },
      },
      { type: "composition_run_started", run_id: "c1", action: "create", workflow_id: "chain" },
      { type: "composition_selected", run_id: "c1", workflow_id: "chain", model_calls: 0 },
      { type: "composition_install_required", run_id: "c1", tools: [], resources: [] },
      { type: "composition_install_progress", run_id: "c1", id: "model", received: 1, total: 2, percent: 50 },
      { type: "composition_install_complete", run_id: "c1", message: "Continuing." },
      { type: "composition_install_denied", run_id: "c1" },
      { type: "composition_stage_started", run_id: "c1", stage_index: 0, source_id: "one" },
      { type: "composition_command_started", run_id: "c1", stage_index: 0, source_id: "one", command_index: 0 },
      { type: "composition_command_completed", run_id: "c1", stage_index: 0, source_id: "one", command_index: 0, exit_code: 0, duration_ms: 3 },
      { type: "composition_verification_started", run_id: "c1", stage_index: 0, source_id: "one" },
      { type: "composition_verification_completed", run_id: "c1", stage_index: 0, source_id: "one", duration_ms: 4 },
      { type: "composition_check_pending", run_id: "c1", stage_index: 0, source_id: "one", name: "plays" },
      { type: "composition_check_result", run_id: "c1", stage_index: 0, source_id: "one", name: "plays", pass: true, expected: "decode", actual: "ok" },
      { type: "composition_cleanup", run_id: "c1", success: true },
      { type: "composition_saved", run_id: "c1", workflow: {
        workflow_id: "chain", created_at: "2026-07-19T00:00:00.000Z",
        stage_count: 2, contract: {
          input: { family: "media", accepted_formats: ["mov"], required_streams: ["video"] },
          output: { family: "media", format: "mp4", streams: ["video"] },
        },
      } },
      { type: "composition_run_complete", run_id: "c1", success: true, output_name: "out.mp4", model_calls: 0 },
      { type: "composition_error", run_id: "c1", message: "Stopped safely." },
    ];
    expect(events.map((event) => parseServerEvent(JSON.stringify(event)).type))
      .toEqual(events.map(({ type }) => type));
  });

  test("rejects malformed known events and all unrecognized enrichment", () => {
    const malformed = [
      {
        type: "composition_stage_started",
        run_id: "c1", source_id: "one",
      },
      {
        type: "composition_run_complete",
        run_id: "c1", success: true, output_name: "out.mp4", model_calls: 1,
      },
      {
        type: "composition_selected",
        run_id: "c1", workflow_id: "chain", model_calls: 0,
        output_root: "/private/tmp/forged",
      },
      {
        type: "command_completed",
        run_id: "r1", exit_code: 0, duration_ms: "fast",
      },
      {
        type: "composable_catalog",
        workflows: [{
          workflow_id: "chain", kind: "composition", eligible: true,
          stage_count: 2, command_count: 2,
        }],
      },
      {
        type: "workflow_catalog",
        workflows: [{
          name: "bad", command_template: { commands: [], output_path: "out" },
          checks: [], created_at: "now", arch: "arm64", tool: "ffmpeg",
          install_weight: "light", composition_contract: {},
        }],
      },
      {
        type: "composition_detail",
        detail: {
          workflow_id: "chain",
          title: "Chain",
          created_at: "2026-07-19T00:00:00.000Z",
          stage_count: 2,
          command_count: 2,
          contract: {
            input: {
              family: "media", accepted_formats: ["mov"],
              required_streams: ["video"],
            },
            output: { family: "media", format: "mp4", streams: ["video"] },
          },
          stages: [{
            stage_index: 0,
            source_id: "one",
            source_title: "One",
            tools: ["ffmpeg"],
            resources: [],
            command_templates: [["ffmpeg", "{{input_0}}"]],
            output_template: "{{input_0_dir}}/one.mp4",
            checks: [{
              check_id: "stage-0-check-0",
              stage_index: 0,
              check_index: 0,
              source_id: "one",
              name: "plays",
              target: true,
              output_root: "/private/tmp/forged",
            }],
          }],
          evidence: [],
          history: [],
        },
      },
    ];
    malformed.forEach((event) => {
      expect(() => parseServerEvent(JSON.stringify(event))).toThrow("payload is unsupported");
    });
  });

  test("rejects semantically inconsistent flattened composition detail", () => {
    const wrongStageCount = semanticDetailEvent();
    wrongStageCount.detail.stage_count = 3;

    const wrongCommandCount = semanticDetailEvent();
    wrongCommandCount.detail.command_count = 3;

    const missingStageIndexBase = semanticDetailEvent();
    const { stage_index: _removedStageIndex, ...stageWithoutIndex } =
      stage(missingStageIndexBase, 0);
    const missingStageIndex = {
      type: "composition_detail",
      detail: {
        ...missingStageIndexBase.detail,
        stages: [stageWithoutIndex, stage(missingStageIndexBase, 1)],
      },
    };

    const duplicateStageIndex = semanticDetailEvent();
    stage(duplicateStageIndex, 1).stage_index = 0;

    const reorderedStages = semanticDetailEvent();
    reorderedStages.detail.stages = [
      stage(reorderedStages, 1), stage(reorderedStages, 0),
    ];

    const nonContiguousStageIndex = semanticDetailEvent();
    stage(nonContiguousStageIndex, 1).stage_index = 2;

    const duplicateSourceId = semanticDetailEvent();
    stage(duplicateSourceId, 1).source_id = "first-command";
    check(duplicateSourceId, 1, 0).source_id = "first-command";

    const mismatchedCheckStage = semanticDetailEvent();
    check(mismatchedCheckStage, 0, 0).stage_index = 1;

    const mismatchedCheckSource = semanticDetailEvent();
    check(mismatchedCheckSource, 0, 0).source_id = "second-command";

    const duplicateCheckIndex = semanticDetailEvent();
    check(duplicateCheckIndex, 0, 1).check_index = 0;

    const reorderedChecks = semanticDetailEvent();
    stage(reorderedChecks, 0).checks = [
      check(reorderedChecks, 0, 1), check(reorderedChecks, 0, 0),
    ];

    const invalidCheckIndex = semanticDetailEvent();
    check(invalidCheckIndex, 0, 1).check_index = -1;

    const duplicateCheckId = semanticDetailEvent();
    check(duplicateCheckId, 0, 1).check_id = "stage-0-check-0";

    const invalidCheckId = semanticDetailEvent();
    check(invalidCheckId, 0, 1).check_id = "stage-0-check-9";

    const malformed = [
      wrongStageCount,
      wrongCommandCount,
      missingStageIndex,
      duplicateStageIndex,
      reorderedStages,
      nonContiguousStageIndex,
      duplicateSourceId,
      mismatchedCheckStage,
      mismatchedCheckSource,
      duplicateCheckIndex,
      reorderedChecks,
      invalidCheckIndex,
      duplicateCheckId,
      invalidCheckId,
    ];
    malformed.forEach((event) => {
      expect(() => parseServerEvent(JSON.stringify(event)))
        .toThrow("payload is unsupported");
    });
  });

  test("a rejected detail event cannot partially replace authoritative detail", () => {
    resetStores();
    applyServerEvent(semanticDetailEvent());
    const before = structuredClone(get(compositions));
    const rejected = semanticDetailEvent();
    rejected.detail.command_count = 7;

    expect(() => parseServerEvent(JSON.stringify(rejected)))
      .toThrow("payload is unsupported");
    expect(get(compositions)).toEqual(before);
  });

  test("requests authoritative detail for catalog compositions with the exact shape", () => {
    const event: WsServerEvent = {
      type: "composable_catalog",
      workflows: [{
        workflow_id: "media-chain",
        kind: "composition",
        eligible: true,
        stage_count: 2,
        command_count: 2,
        contract: {
          input: {
            family: "media", accepted_formats: ["mov"],
            required_streams: ["video"],
          },
          output: { family: "media", format: "mp4", streams: ["video"] },
        },
      }, {
        workflow_id: "convert-media-to-mp4",
        kind: "atomic",
        eligible: true,
        stage_count: 1,
        command_count: 1,
        contract: {
          input: {
            family: "media", accepted_formats: ["mov"],
            required_streams: ["video"],
          },
          output: { family: "media", format: "mp4", streams: ["video"] },
        },
      }],
    };
    const requests = compositionDetailRequests(event);
    expect(requests).toEqual([{
      type: "get_composition_detail",
      workflow_id: "media-chain",
    }]);
    expect(Object.keys(requests[0] ?? {})).toEqual(["type", "workflow_id"]);
  });
});
