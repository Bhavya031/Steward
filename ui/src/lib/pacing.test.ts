import { describe, expect, test } from "bun:test";
import type { ServerEvent } from "../../../server/ws-events.ts";
import { createPacer } from "./pacing.ts";

const runId = "paced-run";

function burst(): ServerEvent[] {
  return [
    { type: "run_started", run_id: runId, action: "recipe", files: ["/tmp/in.mkv"] },
    { type: "recipe_matched", run_id: runId, name: "compress-video-under-size", score: 0.9, model_calls: 0 },
    { type: "activity", run_id: runId, message: "$ ffmpeg -i /tmp/in.mkv /tmp/out.mp4" },
    { type: "run_complete", run_id: runId, success: true, output_path: "/tmp/out.mp4" },
  ];
}

describe("run pacing", () => {
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
      "run_started", "recipe_matched", "activity", "run_complete",
    ]);
    const gaps = seen.slice(1).map((entry, index) => entry.delay - seen[index].delay);
    gaps.forEach((gap) => expect(gap).toBeGreaterThanOrEqual(30));
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
