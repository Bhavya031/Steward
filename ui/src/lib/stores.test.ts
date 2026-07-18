import { describe, expect, test } from "bun:test";
import { get } from "svelte/store";
import type { ServerEvent } from "../../../server/ws-events.ts";
import {
  activity, applyServerEvent, checks, errors, installRequest, killTotal, recipes,
  repairs, resetStores, runHistory, runState,
} from "./stores.ts";

const runId = "store-proof-run";
const failedCheck = {
  name: "size_under",
  pass: false,
  expected: "under 2,000,000 bytes",
  actual: "2,400,000 bytes",
};
const recipe = {
  name: "compress-video-under-size",
  replaced_service: "Clideo",
  monthly_price: 9,
  command_template: {
    commands: [["ffmpeg", "-i", "{{input_0}}", "{{input_0_dir}}/out.mp4"]],
    output_path: "{{input_0_dir}}/out.mp4",
  },
  checks: [{ type: "size_under" as const, target: 2_000_000 }],
  created_at: "2026-07-16T00:00:00.000Z",
  arch: "arm64",
  tool: "ffmpeg" as const,
  install_weight: "light" as const,
};

const stream: ServerEvent[] = [
  { type: "run_started", run_id: runId, action: "task", files: ["/tmp/in.mov"] },
  { type: "activity", run_id: runId, message: "Compressing locally." },
  { type: "command_started", run_id: runId, argv: ["ffmpeg", "-i", "/tmp/in.mov", "/tmp/out.mp4"] },
  { type: "command_completed", run_id: runId, exit_code: 0, duration_ms: 40 },
  { type: "verification_started", run_id: runId },
  { type: "verification_completed", run_id: runId, duration_ms: 12 },
  { type: "check_pending", run_id: runId, name: "size_under" },
  { type: "check_result", run_id: runId, ...failedCheck },
  {
    type: "repair_attempt", run_id: runId, attempt: 2,
    previous_plan: {
      tool: "ffmpeg", command_count: 1, output_path: "/tmp/out.mp4",
      checks: ["size_under"], commands: [["ffmpeg", "-i", "/tmp/in.mov", "/tmp/out.mp4"]],
      intermediates: [], derivations: null,
    },
    failed_checks: [failedCheck], stderr_tail: "",
  },
  { type: "check_pending", run_id: runId, name: "size_under" },
  {
    type: "check_result", run_id: runId, name: "size_under", pass: true,
    expected: "under 2,000,000 bytes", actual: "1,800,000 bytes",
  },
  { type: "recipe_saved", run_id: runId, recipe },
  {
    type: "recipe_matched", run_id: runId,
    name: recipe.name, score: 0.88, model_calls: 0,
  },
  {
    type: "run_complete", run_id: runId, success: true,
    output_path: "/tmp/out.mp4", model_calls: 0,
  },
  { type: "error", message: "Malformed replay event rejected." },
];

describe("UI event stores", () => {
  test("an exhaustive server-event replay lands in typed stores", () => {
    resetStores();
    stream.forEach(applyServerEvent);
    const snapshot = {
      activity: get(activity),
      checks: get(checks),
      recipes: get(recipes).map(({ name, replaced_service, monthly_price }) =>
        ({ name, replaced_service, monthly_price })),
      killTotal: get(killTotal),
      repairs: get(repairs).map(({ attempt, failed_checks }) => ({ attempt, failed_checks })),
      runState: get(runState),
      errors: get(errors),
    };
    console.log(`STORE_REPLAY_SNAPSHOT\n${JSON.stringify(snapshot, null, 2)}`);
    expect(snapshot.checks).toEqual([{
      runId, name: "size_under", status: "passed",
      expected: "under 2,000,000 bytes", actual: "1,800,000 bytes",
    }]);
    expect(snapshot.recipes).toHaveLength(1);
    expect(snapshot.killTotal).toBe(9);
    expect(snapshot.repairs).toHaveLength(1);
    expect(snapshot.runState).toMatchObject({
      id: runId, status: "complete", modelCalls: 0,
      matchedRecipe: recipe.name, matchScore: 0.88,
    });
    expect(snapshot.errors).toHaveLength(1);
  });

  test("check results update one row without changing pending siblings", () => {
    resetStores();
    applyServerEvent({
      type: "run_started", run_id: runId,
      action: "task", files: ["/tmp/in.mov"],
    });
    applyServerEvent({ type: "check_pending", run_id: runId, name: "size_under" });
    applyServerEvent({ type: "check_pending", run_id: runId, name: "duration_matches" });
    expect(get(checks).map(({ status }) => status)).toEqual(["pending", "pending"]);

    applyServerEvent({
      type: "check_result", run_id: runId, name: "size_under", pass: true,
      expected: "under 2,000,000 bytes", actual: "1,800,000 bytes",
    });
    expect(get(checks).map(({ status }) => status)).toEqual(["passed", "pending"]);

    applyServerEvent({
      type: "check_result", run_id: runId, name: "duration_matches", pass: false,
      expected: "5.000 s ±0.500 s", actual: "3.800 s (Δ 1.200 s)",
    });
    expect(get(checks)).toMatchObject([
      { name: "size_under", status: "passed", actual: "1,800,000 bytes" },
      { name: "duration_matches", status: "failed", actual: "3.800 s (Δ 1.200 s)" },
    ]);
  });

  test("shows confirmed model download progress and clears it before continuation", () => {
    resetStores();
    applyServerEvent({
      type: "install_required", run_id: runId, tool: null, command: null,
      resources: [{
        id: "whisper-large-v3-turbo", bytes: 1_624_555_275,
        sha256: "1fc70f", source: "ggerganov/whisper.cpp",
      }],
    });
    expect(get(installRequest)).toMatchObject({
      run_id: runId,
      resources: [{ id: "whisper-large-v3-turbo", bytes: 1_624_555_275 }],
    });
    applyServerEvent({
      type: "install_progress", run_id: runId, id: "whisper-large-v3-turbo",
      received: 812_277_637, total: 1_624_555_275, percent: 50,
    });
    expect(get(installRequest)?.progress).toMatchObject({ percent: 50 });
    applyServerEvent({
      type: "install_complete", run_id: runId,
      message: "Installation verified. Continuing automatically.",
    });
    expect(get(installRequest)).toBeNull();
  });

  test("retains an authoritative planned model-call count through install and resume", () => {
    resetStores();
    applyServerEvent({
      type: "run_started", run_id: "planned-install",
      action: "task", files: ["/tmp/speech.mp4"],
    }, 100);
    applyServerEvent({
      type: "model_call_count", run_id: "planned-install", model_calls: 1,
    }, 110);
    applyServerEvent({
      type: "install_required", run_id: "planned-install", tool: null, command: null,
      resources: [{
        id: "whisper-large-v3-turbo", bytes: 1_624_555_275,
        sha256: "1fc70f", source: "ggerganov/whisper.cpp",
      }],
    }, 120);
    applyServerEvent({
      type: "install_progress", run_id: "planned-install", id: "whisper-large-v3-turbo",
      received: 1_624_555_275, total: 1_624_555_275, percent: 100,
    }, 130);
    applyServerEvent({
      type: "install_complete", run_id: "planned-install",
      message: "Installation verified. Continuing automatically.",
    }, 140);
    expect(get(runState).modelCalls).toBe(1);
    applyServerEvent({
      type: "recipe_saved", run_id: "planned-install", recipe,
    }, 150);
    applyServerEvent({
      type: "run_complete", run_id: "planned-install", success: true,
      output_path: "/tmp/speech.srt", model_calls: 1,
    }, 160);
    expect(get(runState).modelCalls).toBe(1);
    expect(get(runHistory)[0]).toMatchObject({
      runId: "planned-install", modelCalls: 1, success: true,
    });
  });

  test("records zero model calls only when the engine reports a saved-command match", () => {
    resetStores();
    applyServerEvent({
      type: "run_started", run_id: "planned",
      action: "task", files: ["/tmp/source-a.mov"],
    }, 100);
    applyServerEvent({
      type: "model_call_count", run_id: "planned", model_calls: 1,
    }, 150);
    applyServerEvent({ type: "recipe_saved", run_id: "planned", recipe }, 200);
    applyServerEvent({
      type: "run_complete", run_id: "planned", success: true,
      output_path: "/tmp/source-a-compressed.mp4", model_calls: 1,
    }, 300);

    applyServerEvent({
      type: "run_started", run_id: "rerun",
      action: "recipe", files: ["/tmp/source-b.mov"],
    }, 400);
    applyServerEvent({
      type: "recipe_matched", run_id: "rerun",
      name: recipe.name, score: 1, model_calls: 0,
    }, 500);
    applyServerEvent({
      type: "check_result", run_id: "rerun", name: "size_under", pass: true,
      expected: "under 2,000,000 bytes", actual: "1,750,000 bytes",
    }, 600);
    applyServerEvent({
      type: "run_complete", run_id: "rerun", success: true,
      output_path: "/tmp/source-b-compressed.mp4", model_calls: 0,
    }, 700);

    expect(get(runHistory)).toEqual([
      expect.objectContaining({
        runId: "planned", recipeName: recipe.name, action: "task",
        startedAt: 100, completedAt: 300, success: true, modelCalls: 1,
      }),
      expect.objectContaining({
        runId: "rerun", recipeName: recipe.name, action: "recipe",
        startedAt: 400, completedAt: 700, success: true, modelCalls: 0,
        checks: [expect.objectContaining({ name: "size_under", status: "passed" })],
      }),
    ]);
    expect(get(runState).modelCalls).toBe(0);
  });
});
