import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { executePlan, type ExecutionEvent } from "./executor.ts";
import type { Plan } from "./plan.ts";
import { probeSystem } from "./probe.ts";

const root = mkdtempSync(join(tmpdir(), "steward-multi-"));
const profile = probeSystem();
const source = join(root, "source.mp4");

function fixturePlan(): Plan {
  return {
    tool: "ffmpeg", install_cmd: null,
    commands: [[
      "ffmpeg", "-loglevel", "error", "-f", "lavfi",
      "-i", "testsrc2=size=160x90:rate=15", "-t", "2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", source,
    ]],
    output_path: source,
    checks: [{ type: "plays", target: true }],
  };
}

function twoPass(output: string): Plan {
  const video = ["-map", "0:v:0", "-c:v", "libx264", "-b:v", "300k"];
  return {
    tool: "ffmpeg", install_cmd: null,
    commands: [
      [
        "ffmpeg", "-loglevel", "error", "-i", source, ...video,
        "-pass", "1", "-passlogfile", "{{temp_dir}}/stats",
        "-an", "-f", "null", "{{temp_dir}}/pass1.null",
      ],
      [
        "ffmpeg", "-loglevel", "error", "-i", source, ...video,
        "-pass", "2", "-passlogfile", "{{temp_dir}}/stats", output,
      ],
    ],
    output_path: output,
    checks: [{ type: "plays", target: true }],
  };
}

beforeAll(async () => {
  const result = await executePlan(fixturePlan(), profile, []);
  if (!result.ok) throw new Error(result.stderr_tail);
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("multi-command executor", () => {
  test("runs argv arrays sequentially and cleans two-pass stats", async () => {
    const events: ExecutionEvent[] = [];
    const output = join(root, "two-pass.mp4");
    const result = await executePlan(twoPass(output), profile, [source], {
      onEvent: (event) => events.push(event),
    });
    const starts = events.filter((event) => event.type === "started");
    const stats = starts[0]?.type === "started"
      ? starts[0].argv[starts[0].argv.indexOf("-passlogfile") + 1]
      : undefined;
    expect(result.ok).toBe(true);
    expect(result.command_results).toHaveLength(2);
    expect(starts).toHaveLength(2);
    expect(existsSync(output)).toBe(true);
    expect(stats).toBeString();
    expect(existsSync(dirname(stats!))).toBe(false);
  });

  test("stops on the first nonzero exit and cleans temp files", async () => {
    const events: ExecutionEvent[] = [];
    const output = join(root, "must-not-exist.mp4");
    const plan = twoPass(output);
    plan.commands[0]!.splice(-2, 0, "-vf", "not_a_real_filter");
    const result = await executePlan(plan, profile, [source], {
      onEvent: (event) => events.push(event),
    });
    const starts = events.filter((event) => event.type === "started");
    const tempPath = starts[0]?.type === "started"
      ? starts[0].argv.find((arg) => arg.includes("steward-run-"))
      : undefined;
    expect(result.ok).toBe(false);
    expect(result.command_results).toHaveLength(1);
    expect(starts).toHaveLength(1);
    expect(existsSync(output)).toBe(false);
    expect(tempPath).toBeString();
    expect(existsSync(dirname(tempPath!))).toBe(false);
  });

  test("rejects unmanaged multi-pass stats before execution", async () => {
    const output = join(root, "unmanaged.mp4");
    const plan = twoPass(output);
    for (const command of plan.commands) {
      command.splice(command.indexOf("-passlogfile"), 2);
    }
    await expect(executePlan(plan, profile, [source])).rejects.toThrow(
      "inside {{temp_dir}}",
    );
    expect(existsSync(output)).toBe(false);
  });
});
