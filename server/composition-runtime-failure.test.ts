import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  createCompositionOutputRoot, compositionInternalRoot,
} from "./composition-output-root.ts";
import { composition, videoStage } from "./composition-runtime-test-helpers.ts";
import { runComposition } from "./composition-runtime.ts";
import { executePlan, type ExecutionEvent } from "./executor.ts";
import type { Plan, PlanCheck } from "./plan.ts";
import { probeSystem } from "./probe.ts";
import { writeY4m } from "./test-fixtures.ts";
const root = mkdtempSync(join(tmpdir(), "steward-composition-failure-"));
const outside = mkdtempSync(join(tmpdir(), "steward-composition-outside-"));
const frame = join(root, "frame.y4m");
const source = join(root, "source.mp4");
const corrupt = join(root, "corrupt.mp4");
const profile = probeSystem();
writeY4m(frame, 1);
writeFileSync(corrupt, "not media");
beforeAll(async () => {
  const fixture: Plan = {
    name: "composition-failure-fixture",
    tool: "ffmpeg",
    install_cmd: null,
    commands: [["ffmpeg", "-loglevel", "error", "-i", frame,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", source]],
    output_path: source,
    checks: [{ type: "plays", target: true }],
  };
  const result = await executePlan(fixture, profile, [frame]);
  if (!result.ok) throw new Error(result.stderr_tail);
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});
const failingChecks: PlanCheck[] = [
  { type: "format_matches", target: "mp4" },
  { type: "streams_present", target: "video" },
  { type: "plays", target: true },
  { type: "size_under", target: 1 },
];
function tempCompositionRoots(): string[] {
  return readdirSync(tmpdir()).filter((name) => name.startsWith("steward-composition-")).sort();
}
describe("composition failure and confinement", () => {
  test("command failure prevents checks and later stages and cleans the root", async () => {
    const events: ExecutionEvent[] = [];
    const recipe = composition("command-failure-chain", [
      videoStage({ id: "command-fails", suffix: "failed", intermediate: true }),
      videoStage({ id: "must-not-run", suffix: "later" }),
    ]);
    const run = await runComposition(recipe, corrupt, {
      profile, executionOptions: { onEvent: (event) => events.push(event) },
    });
    expect(run).toMatchObject({ success: false, failed_stage: 0, model_calls: 0 });
    expect(run.stages).toHaveLength(1);
    expect(run.stages[0]!.execution.ok).toBe(false);
    expect(run.stages[0]!.checks).toEqual([]);
    const intermediate = events.flatMap((event) => event.type === "started" ? event.argv : [])
      .find((argument) => argument.includes("steward-run-"));
    expect(intermediate).toBeString();
    expect(existsSync(dirname(intermediate!))).toBe(false);
    expect(existsSync(dirname(run.stages[0]!.plan.output_path))).toBe(false);
  });
  test("verification failure prevents later stages and cleans the root", async () => {
    const events: ExecutionEvent[] = [];
    const recipe = composition("verification-failure-chain", [
      videoStage({
        id: "verification-fails", suffix: "failed-check",
        checks: failingChecks, intermediate: true,
      }),
      videoStage({ id: "must-not-run-after-check", suffix: "later" }),
    ]);
    const run = await runComposition(recipe, source, {
      profile, executionOptions: { onEvent: (event) => events.push(event) },
    });
    expect(run).toMatchObject({ success: false, failed_stage: 0 });
    expect(run.stages).toHaveLength(1);
    expect(run.stages[0]!.execution.ok).toBe(true);
    expect(run.stages[0]!.checks.some((check) => !check.pass)).toBe(true);
    const intermediate = events.flatMap((event) => event.type === "started" ? event.argv : [])
      .find((argument) => argument.includes("steward-run-"));
    expect(intermediate).toBeString();
    expect(existsSync(dirname(intermediate!))).toBe(false);
    expect(existsSync(dirname(run.stages[0]!.plan.output_path))).toBe(false);
  });
  test("removes a failed final output and cleans the composition root", async () => {
    const recipe = composition("final-verification-failure", [
      videoStage({ id: "verified-first", suffix: "first", format: "mov" }),
      videoStage({ id: "failed-final", suffix: "failed-final", checks: failingChecks }),
    ]);
    const run = await runComposition(recipe, source, { profile });
    expect(run).toMatchObject({ success: false, failed_stage: 1 });
    expect(run.stages).toHaveLength(2);
    expect(run.stages[1]!.execution.ok).toBe(true);
    expect(existsSync(run.stages[1]!.plan.output_path)).toBe(false);
    expect(existsSync(dirname(run.stages[0]!.plan.output_path))).toBe(false);
  });
  test("cleans the composition root when derivation resolution throws", async () => {
    const before = tempCompositionRoots();
    const derivations = {
      video_bitrate: {
        name: "size_target_video_bitrate" as const,
        args: { target_bytes: 300_000, audio_kbps: 32, safety_factor: 0.9 },
      },
    };
    const recipe = composition("thrown-derivation-chain", [
      videoStage({
        id: "throwing-stage", suffix: "throw", derivations,
        args: ["-c:v", "libx264", "-b:v", "{{video_bitrate}}"],
      }),
      videoStage({ id: "never-after-throw", suffix: "later" }),
    ]);
    await expect(runComposition(recipe, corrupt, { profile })).rejects.toThrow(
      "cannot resolve derivation",
    );
    expect(tempCompositionRoots()).toEqual(before);
  });
  test("requires a live capability and rejects arbitrary output paths", async () => {
    const plan: Plan = {
      name: "capability-check",
      tool: "ffmpeg",
      install_cmd: null,
      commands: [["ffmpeg", "-loglevel", "error", "-i", source,
        "-c", "copy", join(outside, "escaped.mp4")]],
      output_path: join(outside, "escaped.mp4"),
      checks: [{ type: "plays", target: true }],
    };
    await expect(executePlan(plan, profile, [source], {}, {})).rejects.toThrow(
      "capability is invalid",
    );
    const managed = createCompositionOutputRoot(source);
    const internal = compositionInternalRoot(managed.capability);
    expect(statSync(internal).mode & 0o777).toBe(0o700);
    try {
      await expect(executePlan(
        plan, profile, [source], {}, managed.capability,
      )).rejects.toThrow("outside");
      expect(existsSync(plan.output_path)).toBe(false);
    } finally {
      managed.cleanup();
    }
    expect(existsSync(internal)).toBe(false);
  });
});
