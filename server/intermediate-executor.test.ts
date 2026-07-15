import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { executePlan, type ExecutionEvent } from "./executor.ts";
import { TEMP_DIR_SLOT } from "./intermediate-policy.ts";
import type { Plan } from "./plan.ts";
import { probeSystem } from "./probe.ts";
import { writeY4m } from "./test-fixtures.ts";

const root = mkdtempSync(join(tmpdir(), "steward-intermediate-"));
const profile = probeSystem();
const frame = join(root, "frame.y4m");
const source = join(root, "source.mp4");
writeY4m(frame, 2, 160, 90);

function sourcePlan(): Plan {
  return {
    tool: "ffmpeg", install_cmd: null,
    commands: [["ffmpeg", "-loglevel", "error", "-i", frame,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", source]],
    output_path: source, checks: [{ type: "plays", target: true }],
  };
}

function intermediatePlan(output: string): Plan {
  const stage = `${TEMP_DIR_SLOT}/stage.mkv`;
  return {
    tool: "ffmpeg", install_cmd: null,
    commands: [
      ["ffmpeg", "-loglevel", "error", "-i", source, "-c", "copy", stage],
      ["ffmpeg", "-loglevel", "error", "-i", stage, "-c", "copy", output],
    ],
    output_path: output, checks: [{ type: "plays", target: true }],
    intermediates: [stage],
  };
}

beforeAll(async () => {
  const result = await executePlan(sourcePlan(), profile, [frame]);
  if (!result.ok) throw new Error(result.stderr_tail);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("declared intermediate execution", () => {
  test("permits write-then-read and removes the temp root on success", async () => {
    const events: ExecutionEvent[] = [];
    const result = await executePlan(intermediatePlan(join(root, "result.mp4")), profile, [source], {
      onEvent: (event) => events.push(event),
    });
    const first = events.find((event) => event.type === "started");
    const stage = first?.type === "started" ? first.argv.at(-1) : undefined;
    expect(result.ok).toBe(true);
    expect(stage).toContain("steward-run-");
    expect(existsSync(dirname(stage!))).toBe(false);
  });

  test("removes the temp root when a later command fails", async () => {
    const events: ExecutionEvent[] = [];
    const plan = intermediatePlan(join(root, "must-fail.aac"));
    plan.commands[1]!.splice(-1, 0, "-f", "adts");
    const result = await executePlan(plan, profile, [source], { onEvent: (event) => events.push(event) });
    const first = events.find((event) => event.type === "started");
    const stage = first?.type === "started" ? first.argv.at(-1) : undefined;
    expect(result.ok).toBe(false);
    expect(existsSync(dirname(stage!))).toBe(false);
  });

  test("refuses undeclared writes and reads before production", async () => {
    const undeclared = intermediatePlan(join(root, "undeclared.mp4"));
    delete undeclared.intermediates;
    await expect(executePlan(undeclared, profile, [source])).rejects.toThrow("not explicitly granted");
    const earlyRead = intermediatePlan(join(root, "early.mp4"));
    earlyRead.commands.reverse();
    await expect(executePlan(earlyRead, profile, [source])).rejects.toThrow("not explicitly granted");
  });

  test.each([
    join(homedir(), ".ssh", "authorized_keys"),
    join(root, "input-directory-stage.mkv"),
  ])("refuses an intermediate escape before execution: %s", async (escape) => {
    const plan = intermediatePlan(join(root, "escape-result.mp4"));
    plan.intermediates = [escape];
    plan.commands[0]![plan.commands[0]!.length - 1] = escape;
    plan.commands[1]![plan.commands[1]!.indexOf(`${TEMP_DIR_SLOT}/stage.mkv`)] = escape;
    await expect(executePlan(plan, profile, [source])).rejects.toThrow(
      `direct child of ${TEMP_DIR_SLOT}`,
    );
  });
});
