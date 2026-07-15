import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executePlan } from "./executor.ts";
import type { Plan } from "./plan.ts";
import { probeSystem } from "./probe.ts";
import { rerun, save } from "./recipes.ts";
import { writeY4m } from "./test-fixtures.ts";

const root = mkdtempSync(join(tmpdir(), "steward-recipe-cleanup-"));
const frame = join(root, "video.y4m");
const source = join(root, "source.mp4");
const profile = probeSystem();
writeY4m(frame, 1);

beforeAll(async () => {
  const fixture: Plan = {
    tool: "ffmpeg", install_cmd: null,
    commands: [["ffmpeg", "-i", frame, "-t", "1",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", source]],
    output_path: source, checks: [{ type: "plays", target: true }],
  };
  const execution = await executePlan(fixture, profile, [frame]);
  if (!execution.ok) throw new Error(execution.stderr_tail);
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("failed recipe output cleanup", () => {
  test("removes failed output and permits the same input to retry", async () => {
    const output = join(root, "source-short.mp4");
    const plan: Plan = {
      tool: "ffmpeg", install_cmd: null,
      commands: [["ffmpeg", "-i", source, "-t", "0.2", "-c", "copy", output]],
      output_path: output,
      checks: [{ type: "duration_matches", target: source }, { type: "plays", target: true }],
    };
    const recipe = save({
      name: "failed-output-cleanup", replaced_service: "Cleanup test", monthly_price: 1,
      plan, inputPaths: [source], arch: profile.architecture,
      verification: plan.checks.map((check) => ({
        name: check.type, pass: true, expected: "fixture", actual: "fixture",
      })),
    }, join(root, "recipe"));
    if (!recipe) throw new Error("cleanup recipe did not save");
    for (let run = 0; run < 2; run += 1) {
      const result = await rerun(recipe, [source], { profile });
      expect(result.execution.ok).toBe(true);
      expect(result.all_pass).toBe(false);
      expect(existsSync(result.plan.output_path)).toBe(false);
    }
  });
});
