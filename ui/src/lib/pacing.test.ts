import { describe, expect, test } from "bun:test";
import type { ServerEvent } from "../../../server/ws-events.ts";
import { createPacer, STEP_GAP_MS } from "./pacing.ts";
import { createRunProgress, reduceServerEvent } from "./run-progress.ts";

const runId = "paced-run";

function burst(): ServerEvent[] {
  return [
    { type: "run_started", run_id: runId, action: "recipe", files: ["/tmp/in.mkv"] },
    { type: "recipe_matched", run_id: runId, name: "compress-video-under-size", score: 0.9, model_calls: 0 },
    { type: "command_started", run_id: runId, argv: ["ffmpeg", "-i", "/tmp/in.mkv", "/tmp/out.mp4"] },
    { type: "activity", run_id: runId, message: "$ ffmpeg -i /tmp/in.mkv /tmp/out.mp4" },
    { type: "command_completed", run_id: runId, exit_code: 0, duration_ms: 723 },
    { type: "verification_started", run_id: runId },
    { type: "verification_completed", run_id: runId, duration_ms: 61 },
    { type: "run_complete", run_id: runId, success: true, output_path: "/tmp/out.mp4" },
  ];
}

describe("run pacing", () => {
  test("holds every visual stage for one second", () => {
    expect(STEP_GAP_MS).toBe(1_000);
  });

  test("spaces step transitions while keeping order and true receipt times", async () => {
    const seen: Array<{ type: string; delay: number }> = [];
    const started = Date.now();
    const pacer = createPacer((event) => {
      seen.push({ type: event.type, delay: Date.now() - started });
    }, 40);

    burst().forEach((event) => pacer.push(event));
    expect(seen.map(({ type }) => type)).toEqual(["run_started"]);

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(seen.map(({ type }) => type)).toEqual([
      "run_started", "recipe_matched", "command_started", "activity",
      "command_completed", "verification_started", "verification_completed", "run_complete",
    ]);
    const transitions = seen.filter(({ type }) =>
      ["run_started", "recipe_matched", "command_started", "verification_started", "run_complete"]
        .includes(type)
    );
    const gaps = transitions.slice(1)
      .map((entry, index) => entry.delay - transitions[index]!.delay);
    gaps.forEach((gap) => expect(gap).toBeGreaterThanOrEqual(30));
  });

  test("animation pacing cannot change authoritative displayed measurements", async () => {
    let state = createRunProgress();
    const pacer = createPacer((event, receivedAt) => {
      state = reduceServerEvent(state, event, receivedAt);
    }, 25);
    burst().forEach((event) => pacer.push(event));
    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(state.steps.execute.durationMs).toBe(723);
    expect(state.steps.verify.durationMs).toBe(61);
  });

  test("holds the plan-ready handoff before execution", async () => {
    const seen: Array<{ label: string; delay: number }> = [];
    const started = Date.now();
    const pacer = createPacer((event) => {
      const label = event.type === "activity" ? event.message : event.type;
      seen.push({ label, delay: Date.now() - started });
    }, 30);
    [
      { type: "run_started", run_id: runId, action: "task", files: ["/tmp/in.mkv"] },
      { type: "activity", run_id: runId, message: "Planning a local command." },
      { type: "activity", run_id: runId, message: "Plan ready. Preparing local execution." },
      { type: "command_started", run_id: runId, argv: ["ffmpeg", "/tmp/out.mp4"] },
    ].forEach((event) => pacer.push(event as ServerEvent));
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(seen.map(({ label }) => label)).toEqual([
      "run_started", "Planning a local command.",
      "Plan ready. Preparing local execution.", "command_started",
    ]);
    expect(seen[3]!.delay - seen[2]!.delay).toBeGreaterThanOrEqual(20);
  });

  test("a new run flushes any backlog from the previous one", async () => {
    const seen: string[] = [];
    const pacer = createPacer((event) => seen.push(event.type), 1_000);
    burst().forEach((event) => pacer.push(event));
    pacer.push({ type: "run_started", run_id: "next", action: "task", files: ["/tmp/b.mkv"] });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(seen).toEqual(["run_started", "run_started"]);
  });
});
