import { describe, expect, test } from "bun:test";
import type { ExecutionEvent } from "./execution-types.ts";
import type { ServerEvent } from "./ws-events.ts";
import { executionEvents } from "./ws-run-events.ts";

describe("WebSocket execution boundaries", () => {
  test("retains structured command argv and authoritative duration", () => {
    const emitted: ServerEvent[] = [];
    const report = executionEvents("run-1", (event) => emitted.push(event));
    const events: ExecutionEvent[] = [
      { type: "started", argv: ["ffmpeg", "-i", "/tmp/in.mov", "/tmp/out.mov"] },
      {
        type: "completed",
        result: {
          ok: true, exit_code: 0, timed_out: false, duration_ms: 417,
          stdout_tail: "", stderr_tail: "",
        },
      },
    ];
    events.forEach(report);
    expect(emitted).toEqual([
      {
        type: "command_started", run_id: "run-1",
        argv: ["ffmpeg", "-i", "/tmp/in.mov", "/tmp/out.mov"],
      },
      {
        type: "activity", run_id: "run-1",
        message: "$ ffmpeg -i /tmp/in.mov /tmp/out.mov",
      },
      {
        type: "command_completed", run_id: "run-1",
        exit_code: 0, duration_ms: 417,
      },
      {
        type: "activity", run_id: "run-1",
        message: "Command exited 0 in 417 ms.",
      },
    ]);
  });
});
