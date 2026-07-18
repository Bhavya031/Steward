import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executePlan } from "./executor.ts";
import { allocatePlanOutput } from "./output-allocation.ts";
import type { Plan } from "./plan.ts";
import { probeSystem } from "./probe.ts";
import { rerun, save } from "./recipes.ts";
import { runWithRepair } from "./repair-loop.ts";
import { writeY4m } from "./test-fixtures.ts";

const root = mkdtempSync(join(tmpdir(), "steward-output-allocation-"));
const outside = mkdtempSync(join(tmpdir(), "steward-output-outside-"));
const profile = probeSystem();
const frame = join(root, "frames.y4m");
const source = join(root, "source.mp4");
const realRoot = realpathSync(root);
writeY4m(frame, 1);

function copyPlan(output: string): Plan {
  return {
    name: "copy-video",
    tool: "ffmpeg",
    install_cmd: null,
    commands: [["ffmpeg", "-loglevel", "error", "-i", source, "-c", "copy", output]],
    output_path: output,
    checks: [{ type: "plays", target: true }],
  };
}

beforeAll(async () => {
  const fixture: Plan = {
    ...copyPlan(source),
    name: "generate-video",
    commands: [["ffmpeg", "-loglevel", "error", "-i", frame,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", source]],
  };
  const result = await executePlan(fixture, profile, [frame]);
  if (!result.ok) throw new Error(result.stderr_tail);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe("output collision allocation", () => {
  test("uses deterministic suffixes and rewrites commands, checks, and SRT prefixes", () => {
    const output = join(root, "captions.srt");
    writeFileSync(output, "occupied");
    writeFileSync(join(root, "captions-2.srt"), "occupied");
    const plan: Plan = {
      name: "subtitle-video",
      tool: "whisper-cli",
      install_cmd: null,
      commands: [[
        "whisper-cli", "-m", "/tmp/model.bin", "-f", source,
        "-osrt", "-of", output.slice(0, -4),
      ]],
      output_path: output,
      checks: [
        { type: "srt_valid", target: true },
        { type: "duration_matches", target: output },
      ],
    };
    const allocated = allocatePlanOutput(plan, [source]);
    expect(allocated.output_path).toBe(join(realRoot, "captions-3.srt"));
    expect(allocated.commands[0]?.at(-1)).toBe(join(realRoot, "captions-3"));
    expect(allocated.checks[1]?.target).toBe(join(realRoot, "captions-3.srt"));
    expect(readFileSync(output, "utf8")).toBe("occupied");
  });

  test("refuses to move a suffixed output outside the granted input directory", () => {
    const output = join(outside, "escaped.mp4");
    expect(() => allocatePlanOutput(copyPlan(output), [source])).toThrow(
      "outside the input directory",
    );
  });

  test("keeps the authored plan as the recipe while first and saved runs allocate", async () => {
    const output = join(root, "source-copy.mp4");
    writeFileSync(output, "existing output");
    const authored = copyPlan(output);
    let firstVerificationDuration: number | undefined;
    const first = await runWithRepair({
      initialPlan: authored,
      profile,
      inputPaths: [source],
      repair: async () => { throw new Error("repair should not run"); },
      onVerificationCompleted: (durationMs) => { firstVerificationDuration = durationMs; },
    });
    expect(first.all_pass).toBe(true);
    expect(firstVerificationDuration).toBeGreaterThanOrEqual(0);
    expect(first.plan).toEqual(authored);
    expect(first.resolvedPlan.output_path).toBe(join(realRoot, "source-copy-2.mp4"));
    expect(first.resolvedPlan.commands[0]?.at(-1)).toBe(first.resolvedPlan.output_path);
    expect(readFileSync(output, "utf8")).toBe("existing output");

    const recipe = save({
      plan: first.plan,
      inputPaths: [source],
      verification: first.checks,
      arch: profile.architecture,
    }, join(root, "recipes"));
    if (!recipe) throw new Error("verified plan did not save");
    expect(recipe.command_template.output_path).not.toContain("-2");

    let savedVerificationDuration: number | undefined;
    const saved = await rerun(recipe, [source], {
      profile,
      onVerificationCompleted: (durationMs) => { savedVerificationDuration = durationMs; },
    });
    expect(saved.all_pass).toBe(true);
    expect(savedVerificationDuration).toBeGreaterThanOrEqual(0);
    expect(saved.plan.output_path).toBe(join(realRoot, "source-copy-3.mp4"));
    expect(saved.plan.commands[0]?.at(-1)).toBe(saved.plan.output_path);
  });
});
