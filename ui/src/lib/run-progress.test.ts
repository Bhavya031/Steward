import { describe, expect, test } from "bun:test";
import {
  createRunProgress, executeElapsedMs, reduceClientEvent, reduceServerEvent,
} from "./run-progress.ts";
import { formatClock, pipelineSegments, stepTool } from "./receipt-view.ts";
import { stepDuration, totalDuration } from "./run-view.ts";

describe("running-state event clock", () => {
  test("marks skipped probe and keeps authoritative multi-command and verification timing", () => {
    let state = reduceClientEvent(createRunProgress(), {
      type: "run_task",
      task: "compress this video under 25 MB",
      files: ["/tmp/holiday-video.mkv"],
    });
    state = reduceServerEvent(state, {
      type: "run_started", run_id: "run-1",
      action: "task", files: ["/tmp/holiday-video.mkv"],
    }, 1_000);
    state = reduceServerEvent(state, {
      type: "recipe_matched", run_id: "run-1",
      name: "compress-video-under-size", score: 0.95, model_calls: 0,
    }, 1_120);
    state = reduceServerEvent(state, {
      type: "command_started", run_id: "run-1",
      argv: ["ffmpeg", "-i", "/tmp/holiday-video.mkv", "-pass", "1", "/tmp/null"],
    }, 1_340);

    expect(state.steps.plan).toMatchObject({
      status: "complete", durationMs: 120, note: "0 model calls",
    });
    expect(state.steps.probe).toEqual({ status: "skipped" });
    expect(stepDuration(state, "probe", 1_840)).toBe("SKIPPED");
    expect(stepTool(state, "probe", "compress-video-under-size")).toBe("—");
    expect(pipelineSegments(state)).not.toContainEqual({ kind: "bash", label: "ffprobe" });
    expect(executeElapsedMs(state, 1_840)).toBe(500);

    state = reduceServerEvent(state, {
      type: "command_completed", run_id: "run-1", exit_code: 0, duration_ms: 300,
    }, 1_700);
    state = reduceServerEvent(state, {
      type: "command_started", run_id: "run-1",
      argv: ["ffmpeg", "-i", "/tmp/holiday-video.mkv", "-pass", "2", "/tmp/out.mp4"],
    }, 1_720);
    state = reduceServerEvent(state, {
      type: "command_completed", run_id: "run-1", exit_code: 0, duration_ms: 423,
    }, 2_100);
    state = reduceServerEvent(state, {
      type: "verification_started", run_id: "run-1",
    }, 2_120);
    state = reduceServerEvent(state, {
      type: "verification_completed", run_id: "run-1", duration_ms: 81,
    }, 2_201);
    state = reduceServerEvent(state, {
      type: "check_result", run_id: "run-1", name: "size_under",
      pass: true, expected: "under 25,000,000 bytes", actual: "18,000,000 bytes",
    }, 2_210);
    state = reduceServerEvent(state, {
      type: "run_complete", run_id: "run-1", success: true,
      output_path: "/tmp/out.mp4", model_calls: 0,
    }, 2_300);

    expect(state.steps.execute).toMatchObject({ status: "complete", durationMs: 723 });
    expect(state.steps.verify).toMatchObject({ status: "complete", durationMs: 81 });
    expect(state.commands).toHaveLength(2);
    expect(totalDuration(state)).toBe("0.92s");
  });

  test("renders no timing when a step has no observable boundary", () => {
    const state = createRunProgress();
    expect(state.steps.verify.startedAt).toBeUndefined();
    expect(state.steps.verify.durationMs).toBeUndefined();
    expect(formatClock(state.steps.verify.durationMs)).toBe("—");
    expect(totalDuration(state)).toBe("—");
  });

  test("a check event settles plan and probe even without a command line", () => {
    let state = reduceServerEvent(createRunProgress(), {
      type: "run_started", run_id: "run-3", action: "recipe", files: ["/tmp/in.mkv"],
    }, 1_000);
    state = reduceServerEvent(state, {
      type: "recipe_matched", run_id: "run-3",
      name: "compress-video-under-size", score: 0.9, model_calls: 0,
    }, 1_050);
    state = reduceServerEvent(state, {
      type: "check_result", run_id: "run-3", name: "size_under",
      pass: false, expected: "under 25,000,000 bytes", actual: "missing output",
    }, 1_400);
    expect(state.steps.plan.status).toBe("complete");
    expect(state.steps.probe.status).toBe("skipped");
    expect(state.steps.execute.status).toBe("complete");
    expect(state.steps.execute.durationMs).toBeUndefined();
    expect(state.steps.verify.status).toBe("active");
  });

  test("never leaves an earlier step pending after a later stage completes", () => {
    let state = reduceServerEvent(createRunProgress(), {
      type: "run_started", run_id: "run-5", action: "task", files: ["/tmp/in.mkv"],
    }, 1_000);
    state = reduceServerEvent(state, {
      type: "verification_completed", run_id: "run-5", duration_ms: 44,
    }, 1_500);
    expect(state.steps.plan.status).toBe("complete");
    expect(state.steps.probe.status).toBe("skipped");
    expect(state.steps.execute.status).toBe("complete");
    expect(state.steps.verify).toMatchObject({ status: "complete", durationMs: 44 });
  });

  test("probing gets its own stage and pending checks do not jump ahead", () => {
    let state = reduceServerEvent(createRunProgress(), {
      type: "run_started", run_id: "run-4", action: "task", files: ["/tmp/in.mkv"],
    }, 1_000);
    state = reduceServerEvent(state, {
      type: "activity", run_id: "run-4",
      message: "No saved recipe matched. Reading the local system profile.",
    }, 1_400);
    expect(state.steps.plan.status).toBe("complete");
    expect(state.steps.probe.status).toBe("active");
    state = reduceServerEvent(state, {
      type: "check_pending", run_id: "run-4", name: "size_under",
    }, 1_600);
    expect(state.steps.probe.status).toBe("active");
    expect(state.steps.execute.status).toBe("pending");
    expect(state.steps.verify.status).toBe("pending");
  });

  test("keeps the failed step active instead of presenting it as complete", () => {
    let state = reduceServerEvent(createRunProgress(), {
      type: "run_started", run_id: "run-2", action: "recipe", files: ["/tmp/in.mov"],
    }, 1_000);
    state = reduceServerEvent(state, {
      type: "command_started", run_id: "run-2",
      argv: ["ffmpeg", "-i", "/tmp/in.mov", "/tmp/out.mp4"],
    }, 1_100);
    state = reduceServerEvent(state, {
      type: "error", run_id: "run-2", message: "refusing to overwrite output",
    }, 1_200);
    state = reduceServerEvent(state, {
      type: "run_complete", run_id: "run-2", success: false,
    }, 1_210);
    expect(state.steps.execute.status).toBe("active");
    expect(state.activity).toBe("refusing to overwrite output");
  });

  test("captures bounded activity detail without sharing reducer snapshots", () => {
    let first = reduceServerEvent(createRunProgress(), {
      type: "run_started", run_id: "run-3", action: "task", files: ["/tmp/in.mov"],
    }, 1_000);
    first = reduceServerEvent(first, {
      type: "activity", run_id: "run-3", message: "Checking the local recipe shelf.",
    }, 1_010);
    const second = reduceServerEvent(first, {
      type: "activity", run_id: "run-3", message: "Planning a local command.",
    }, 1_020);
    expect(first.steps.plan.detail).toEqual(["Checking the local recipe shelf."]);
    expect(second.steps.plan.detail).toEqual([
      "Checking the local recipe shelf.", "Planning a local command.",
    ]);
    expect(second.steps.plan.detail).not.toBe(first.steps.plan.detail);
  });
});
