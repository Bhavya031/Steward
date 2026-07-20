import { describe, expect, test } from "bun:test";
import { get } from "svelte/store";
import type { WsServerEvent } from "../../../server/ws-events.ts";
import {
  applyClientEvent, applyServerEvent, checks, composableCatalog, compositions,
  compositionStages, compositionSubmissionPending, handleConnectionClosed,
  handleConnectionOpened, installRequest, recipes, rememberCompositionInputName,
  resetStores, runHistory, runProgress, runState,
} from "./stores.ts";

const contract = {
  input: {
    family: "media" as const, accepted_formats: ["mov" as const, "mp4" as const],
    required_streams: ["video" as const],
  },
  output: {
    family: "media" as const, format: "mp4" as const,
    streams: ["video" as const],
  },
};
const atomic = (name: string) => ({
  name,
  command_template: {
    commands: [["ffmpeg", "-i", "{{input_0}}", `{{input_0_dir}}/${name}.mp4`]],
    output_path: `{{input_0_dir}}/${name}.mp4`,
  },
  checks: [{ type: "plays" as const, target: true }],
  created_at: "2026-07-19T00:00:00.000Z",
  arch: "arm64",
  tool: "ffmpeg" as const,
  install_weight: "light" as const,
});
const catalog = ["first-command", "second-command"].map((workflow_id) => ({
  workflow_id, kind: "atomic" as const, eligible: true as const,
  stage_count: 1, command_count: 1, contract,
}));

function authoritativeDetail(): Extract<
  WsServerEvent, { type: "composition_detail" }
>["detail"] {
  return {
    workflow_id: "media-chain",
    title: "Media Chain",
    created_at: "2026-07-19T01:00:00.000Z",
    stage_count: 2,
    command_count: 2,
    contract,
    stages: [
      {
        stage_index: 0,
        source_id: "first-command",
        source_title: "First Command",
        tools: ["ffmpeg"],
        resources: [],
        command_templates: [[
          "ffmpeg", "-i", "{{input_0}}",
          "{{input_0_dir}}/first-command.mp4",
        ]],
        output_template: "{{input_0_dir}}/first-command.mp4",
        checks: [{
          check_id: "stage-0-check-0", stage_index: 0, check_index: 0,
          source_id: "first-command", name: "plays", target: true,
        }],
      },
      {
        stage_index: 1,
        source_id: "second-command",
        source_title: "Second Command",
        tools: ["ffmpeg"],
        resources: [],
        command_templates: [[
          "ffmpeg", "-i", "{{input_0}}",
          "{{input_0_dir}}/second-command.mp4",
        ]],
        output_template: "{{input_0_dir}}/second-command.mp4",
        checks: [{
          check_id: "stage-1-check-0", stage_index: 1, check_index: 0,
          source_id: "second-command", name: "plays", target: true,
        }],
      },
    ],
    evidence: [],
    history: [],
  };
}

function begin(): void {
  resetStores();
  applyServerEvent({ type: "workflow_catalog", workflows: [
    atomic("first-command"), atomic("second-command"),
  ] });
  applyServerEvent({ type: "composable_catalog", workflows: catalog });
  rememberCompositionInputName("holiday.mov");
  applyClientEvent({
    type: "run_composition", name: "media-chain",
    workflow_ids: ["first-command", "second-command"],
    staged_input_id: "d9428888-122b-4e7f-a15b-3f708bc090f1",
  });
  applyServerEvent({
    type: "composition_run_started", run_id: "chain-run",
    action: "create", workflow_id: "media-chain",
  }, 100);
}

describe("composition UI stores", () => {
  test("waits for authoritative model metadata before displaying zero calls", () => {
    begin();
    expect(get(runState).modelCalls).toBeUndefined();
    expect(get(runProgress).steps.plan.note).toBeUndefined();
    applyServerEvent({
      type: "model_call_count", run_id: "chain-run", model_calls: 0,
    });
    expect(get(runState).modelCalls).toBe(0);
    expect(get(runProgress).steps.plan.note).toBe("0 model calls");
  });

  test("hydrates a fresh catalog-only composition from authoritative detail", () => {
    resetStores();
    applyServerEvent({
      type: "composable_catalog",
      workflows: [{
        workflow_id: "media-chain", kind: "composition", eligible: true,
        stage_count: 2, command_count: 2, contract,
      }],
    });
    expect(get(compositions)).toEqual([
      expect.objectContaining({ name: "media-chain", stages: [] }),
    ]);
    expect(get(compositions)[0]?.detail).toBeUndefined();

    applyServerEvent({
      type: "composition_detail",
      detail: authoritativeDetail(),
    });
    expect(get(compositions)[0]?.detail).toMatchObject({
      workflow_id: "media-chain",
      stages: [
        { stage_index: 0, source_id: "first-command", tools: ["ffmpeg"] },
        { stage_index: 1, source_id: "second-command", tools: ["ffmpeg"] },
      ],
    });
  });

  test("keeps stage-tagged duplicate checks and saves zero-call history", () => {
    begin();
    const stream: WsServerEvent[] = [
      { type: "model_call_count", run_id: "chain-run", model_calls: 0 },
      { type: "composition_stage_started", run_id: "chain-run", stage_index: 0, source_id: "first-command" },
      { type: "composition_command_started", run_id: "chain-run", stage_index: 0, source_id: "first-command", command_index: 0 },
      { type: "composition_command_completed", run_id: "chain-run", stage_index: 0, source_id: "first-command", command_index: 0, exit_code: 0, duration_ms: 20 },
      { type: "composition_check_pending", run_id: "chain-run", stage_index: 0, source_id: "first-command", name: "plays" },
      { type: "composition_check_result", run_id: "chain-run", stage_index: 0, source_id: "first-command", name: "plays", pass: true, expected: "decode", actual: "stage one ok" },
      { type: "composition_stage_started", run_id: "chain-run", stage_index: 1, source_id: "second-command" },
      { type: "composition_check_pending", run_id: "chain-run", stage_index: 1, source_id: "second-command", name: "plays" },
      { type: "composition_check_result", run_id: "chain-run", stage_index: 1, source_id: "second-command", name: "plays", pass: true, expected: "decode", actual: "stage two ok" },
      { type: "composition_cleanup", run_id: "chain-run", success: true },
      {
        type: "composition_saved", run_id: "chain-run",
        workflow: {
          workflow_id: "media-chain", created_at: "2026-07-19T01:00:00.000Z",
          stage_count: 2, contract,
        },
      },
      {
        type: "composition_run_complete", run_id: "chain-run",
        success: true, output_name: "holiday-second-command.mp4", model_calls: 0,
      },
    ];
    stream.forEach((event, index) => applyServerEvent(event, 110 + index));
    expect(get(checks)).toMatchObject([
      { stageIndex: 0, sourceId: "first-command", name: "plays", status: "passed" },
      { stageIndex: 1, sourceId: "second-command", name: "plays", status: "passed" },
    ]);
    expect(get(compositionStages)).toHaveLength(2);
    expect(get(compositions)[0]).toMatchObject({
      name: "media-chain", stage_count: 2,
      stages: [
        { stage_index: 0, source_id: "first-command", tool: "ffmpeg" },
        { stage_index: 1, source_id: "second-command", tool: "ffmpeg" },
      ],
    });
    compositions.set([]);
    applyServerEvent({
      type: "composable_catalog",
      workflows: [...catalog, {
        workflow_id: "media-chain", kind: "composition",
        eligible: true, stage_count: 2, command_count: 2, contract,
      }],
    });
    expect(get(compositions)[0]).toMatchObject({
      name: "media-chain", stages: [],
    });
    applyServerEvent({
      type: "composition_detail",
      detail: authoritativeDetail(),
    });
    expect(get(compositions)[0]?.detail?.stages).toHaveLength(2);
    expect(get(runHistory)[0]).toMatchObject({
      recipeName: "media-chain", action: "composition", files: ["holiday.mov"],
      success: true, outputName: "holiday-second-command.mp4",
      modelCalls: 0, composition: true,
    });
    expect(get(runState)).toMatchObject({
      status: "complete", outputName: "holiday-second-command.mp4",
      modelCalls: 0, composition: true,
    });
  });

  test("tracks approval, download, resume, denial, cancellation, and failure honestly", () => {
    begin();
    applyServerEvent({
      type: "composition_install_required", run_id: "chain-run",
      tools: [{ tools: ["ffmpeg"], command: ["brew", "install", "ffmpeg"] }],
      resources: [{
        id: "whisper-large-v3-turbo", bytes: 100, sha256: "sha", source: "official",
      }],
    });
    expect(get(installRequest)).toMatchObject({
      tools: [{ tools: ["ffmpeg"] }], resources: [{ id: "whisper-large-v3-turbo" }],
    });
    applyServerEvent({
      type: "composition_install_progress", run_id: "chain-run",
      id: "whisper-large-v3-turbo", received: 50, total: 100, percent: 50,
    });
    expect(get(installRequest)?.progress).toMatchObject({ percent: 50 });
    applyServerEvent({
      type: "composition_install_complete", run_id: "chain-run", message: "Continuing.",
    });
    expect(get(installRequest)).toBeNull();

    applyServerEvent({
      type: "composition_install_required", run_id: "chain-run", tools: [], resources: [],
    });
    applyServerEvent({ type: "composition_install_denied", run_id: "chain-run" });
    expect(get(installRequest)).toBeNull();
    applyServerEvent({
      type: "composition_error", run_id: "chain-run", message: "Connection closed safely.",
    });
    applyServerEvent({
      type: "composition_run_complete", run_id: "chain-run", success: false, model_calls: 0,
    });
    expect(get(runState)).toMatchObject({ status: "failed", modelCalls: 0 });
    expect(get(compositions)).toHaveLength(0);
  });

  test("clears installation state on every terminal composition path", () => {
    begin();
    applyServerEvent({
      type: "composition_install_required", run_id: "chain-run",
      tools: [], resources: [],
    });
    applyServerEvent({
      type: "composition_error", run_id: "chain-run", message: "Checksum failed safely.",
    });
    expect(get(installRequest)).toBeNull();

    begin();
    applyServerEvent({
      type: "composition_install_required", run_id: "chain-run",
      tools: [], resources: [],
    });
    applyServerEvent({
      type: "composition_run_complete", run_id: "chain-run",
      success: false, model_calls: 0,
    });
    expect(get(installRequest)).toBeNull();
  });

  test("ignores stale run events and revokes a disconnected run", () => {
    begin();
    applyServerEvent({
      type: "composition_run_started", run_id: "new-run",
      action: "recipe", workflow_id: "new-chain",
    });
    applyServerEvent({
      type: "composition_stage_started", run_id: "chain-run",
      stage_index: 7, source_id: "stale-stage",
    });
    applyServerEvent({
      type: "composition_run_complete", run_id: "chain-run",
      success: true, output_name: "stale.mp4", model_calls: 0,
    });
    expect(get(runState)).toMatchObject({
      id: "new-run", status: "running", matchedRecipe: "new-chain",
    });
    expect(get(compositionStages)).toEqual([]);

    applyServerEvent({
      type: "composition_stage_started", run_id: "new-run",
      stage_index: 0, source_id: "new-stage",
    });
    expect(get(compositionStages)).toHaveLength(1);
    applyServerEvent({
      type: "composition_install_required", run_id: "new-run",
      tools: [], resources: [],
    });
    handleConnectionClosed();
    expect(get(installRequest)).toBeNull();
    expect(get(compositionStages)).toEqual([]);
    expect(get(runState)).toMatchObject({ status: "failed" });
    expect(get(runState).id).toBeUndefined();
    applyServerEvent({
      type: "composition_run_started", run_id: "late-start",
      action: "recipe", workflow_id: "late-chain",
    });
    applyServerEvent({
      type: "composition_stage_started", run_id: "late-start",
      stage_index: 0, source_id: "late-stage",
    });
    applyServerEvent({
      type: "composition_run_complete", run_id: "new-run",
      success: true, output_name: "late.mp4", model_calls: 0,
    });
    expect(get(runState).outputName).not.toBe("late.mp4");
    expect(get(compositionStages)).toEqual([]);

    handleConnectionOpened();
    applyServerEvent({
      type: "composition_run_started", run_id: "reconnected-run",
      action: "recipe", workflow_id: "new-chain",
    });
    expect(get(runState).id).toBe("reconnected-run");
  });

  test("close after submit but before start restores actionable composition state", () => {
    resetStores();
    applyClientEvent({
      type: "run_composition",
      name: "media-chain",
      workflow_ids: ["first-command", "second-command"],
      staged_input_id: "d9428888-122b-4e7f-a15b-3f708bc090f1",
    });
    expect(get(compositionSubmissionPending)).toBe(true);
    expect(get(runState)).toEqual({ status: "idle" });

    handleConnectionClosed();
    expect(get(compositionSubmissionPending)).toBe(false);
    expect(get(compositionStages)).toEqual([]);
    applyServerEvent({
      type: "composition_run_started", run_id: "late-after-close",
      action: "create", workflow_id: "media-chain",
    });
    applyServerEvent({
      type: "composition_stage_started", run_id: "late-after-close",
      stage_index: 0, source_id: "first-command",
    });
    expect(get(runState)).toEqual({ status: "idle" });
    expect(get(compositionStages)).toEqual([]);
  });

  test("a failed stage never invents progress for a later stage", () => {
    begin();
    applyServerEvent({
      type: "composition_stage_started", run_id: "chain-run",
      stage_index: 0, source_id: "first-command",
    });
    applyServerEvent({
      type: "composition_command_started", run_id: "chain-run",
      stage_index: 0, source_id: "first-command", command_index: 0,
    });
    applyServerEvent({
      type: "composition_command_completed", run_id: "chain-run",
      stage_index: 0, source_id: "first-command", command_index: 0,
      exit_code: 1, duration_ms: 3,
    });
    applyServerEvent({
      type: "composition_run_complete", run_id: "chain-run", success: false, model_calls: 0,
    });
    expect(get(compositionStages)).toEqual([
      expect.objectContaining({ stageIndex: 0, status: "failed" }),
    ]);
    expect(get(compositionStages).some(({ stageIndex }) => stageIndex === 1)).toBe(false);
  });

  test("numbers stage commands from authored templates on live runs and after reload", () => {
    begin();
    const detail = authoritativeDetail();
    const stream: WsServerEvent[] = [];
    for (const stage of detail.stages) {
      stream.push({
        type: "composition_stage_started", run_id: "chain-run",
        stage_index: stage.stage_index, source_id: stage.source_id,
      });
      // Only authored template commands produce numbered command events.
      stage.command_templates.forEach((_command, commandIndex) => {
        stream.push({
          type: "composition_command_started", run_id: "chain-run",
          stage_index: stage.stage_index, source_id: stage.source_id,
          command_index: commandIndex,
        });
        stream.push({
          type: "composition_command_completed", run_id: "chain-run",
          stage_index: stage.stage_index, source_id: stage.source_id,
          command_index: commandIndex, exit_code: 0, duration_ms: 12,
        });
      });
      // Verification helpers surface only as verification and check progress.
      stream.push({
        type: "composition_verification_started", run_id: "chain-run",
        stage_index: stage.stage_index, source_id: stage.source_id,
      });
      stream.push({
        type: "composition_check_result", run_id: "chain-run",
        stage_index: stage.stage_index, source_id: stage.source_id,
        name: "plays", pass: true, expected: "decode", actual: "ok",
      });
      stream.push({
        type: "composition_verification_completed", run_id: "chain-run",
        stage_index: stage.stage_index, source_id: stage.source_id, duration_ms: 30,
      });
    }
    stream.forEach((event, index) => applyServerEvent(event, 200 + index));

    // CompositionStageProgress renders `Command {index + 1}` for each entry here.
    const live = get(compositionStages);
    expect(live).toHaveLength(detail.stages.length);
    live.forEach((stage, stageIndex) => {
      const authored = detail.stages[stageIndex]!.command_templates.length;
      expect(stage.commands).toHaveLength(authored);
      expect(stage.commands.map((command) => command.index + 1))
        .toEqual([...Array(authored).keys()].map((index) => index + 1));
      expect(stage.commands.every((command) => command.status === "passed")).toBe(true);
    });

    // Reload from the authoritative server detail must agree with the live numbering.
    applyServerEvent({ type: "composition_detail", detail });
    const reloaded = get(compositions).find(({ name }) => name === "media-chain");
    expect(reloaded?.detail?.stages).toHaveLength(detail.stages.length);
    reloaded?.detail?.stages.forEach((stage, stageIndex) => {
      expect(stage.command_templates).toHaveLength(live[stageIndex]!.commands.length);
    });
  });
});
