import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executePlan, type ExecutionEvent } from "./executor.ts";
import type { Plan } from "./plan.ts";
import { probeSystem } from "./probe.ts";
import { runWithRepair } from "./repair-loop.ts";
import { writeWav, writeY4m } from "./test-fixtures.ts";

const root = mkdtempSync(join(tmpdir(), "steward-repair-"));
const realRoot = realpathSync(root);
const profile = probeSystem();
const source = join(root, "source.mp4");
const frame = join(root, "video.y4m");
const tone = join(root, "tone.wav");
writeY4m(frame, 2);
writeWav(tone, 2);

function sourcePlan(): Plan {
  return {
    name: "repair-video",
    tool: "ffmpeg", install_cmd: null,
    commands: [[
      "ffmpeg", "-loglevel", "error",
      "-i", frame, "-i", tone,
      "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p",
      "-c:a", "aac", source,
    ]],
    output_path: source,
    checks: [{ type: "plays", target: true }],
  };
}

function attemptPlan(output: string, short: boolean): Plan {
  const duration = short ? ["-t", "0.3"] : [];
  return {
    name: "repair-video",
    tool: "ffmpeg", install_cmd: null,
    commands: [["ffmpeg", "-loglevel", "error", "-i", source, ...duration, "-c", "copy", output]],
    output_path: output,
    checks: [
      { type: "duration_matches", target: source },
      { type: "streams_present", target: "video,audio" },
      { type: "plays", target: true },
    ],
  };
}

beforeAll(async () => {
  const result = await executePlan(sourcePlan(), profile, [frame, tone]);
  if (!result.ok) throw new Error(result.stderr_tail);
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("repair loop", () => {
  test("materializes a declared derivation but retains the authored plan", async () => {
    const output = join(root, "derived.mp4");
    const authored: Plan = {
      ...attemptPlan(output, false),
      commands: [[
        "ffmpeg", "-loglevel", "error", "-i", source, "-c:v", "libx264",
        "-b:v", "{{video_bitrate_kbps}}", "-c:a", "aac", output,
      ]],
      derivations: {
        video_bitrate_kbps: {
          name: "size_target_video_bitrate",
          args: { target_bytes: 1_000_000, audio_kbps: 96, safety_factor: 0.9 },
        },
      },
    };
    const authoredSnapshot = structuredClone(authored);
    writeFileSync(output, "occupied");
    const events: ExecutionEvent[] = [];
    const run = await runWithRepair({
      initialPlan: authored, profile, inputPaths: [source],
      executionOptions: { onEvent: (event) => events.push(event) },
      repair: async () => { throw new Error("repair should not run"); },
    });
    const started = events.find((event) => event.type === "started");
    expect(run.all_pass).toBe(true);
    expect(run.events).toHaveLength(1);
    expect(run.events[0]?.outcome.status).toBe("passed");
    expect(authored).toEqual(authoredSnapshot);
    expect(run.plan).toEqual(authoredSnapshot);
    expect(run.resolvedPlan.output_path).toBe(join(realRoot, "derived-2.mp4"));
    expect(run.resolvedPlan.derivations).toBeUndefined();
    expect(run.resolvedPlan.commands.flat()).not.toContain("{{video_bitrate_kbps}}");
    expect(started?.type === "started" ? started.argv.join(" ") : "").not.toContain("{{");
  });

  test("emits failed evidence then recovers to green", async () => {
    const output = join(root, "recovered.mp4");
    const initial = attemptPlan(output, true);
    const run = await runWithRepair({
      initialPlan: initial,
      profile,
      inputPaths: [source],
      repair: async (context) => {
        expect(context.original_plan).toEqual(initial);
        expect(context.failed_checks.some((check) => check.name === "duration_matches")).toBe(true);
        return attemptPlan(output, false);
      },
    });
    expect(run.all_pass).toBe(true);
    expect(run.events.map((event) => event.attempt)).toEqual([1, 2]);
    expect(run.events.map((event) => event.outcome.status)).toEqual([
      "verification_failed", "passed",
    ]);
    expect(run.events[0]?.outcome.failed_checks[0]?.actual).toContain("Δ");
    expect(run.checks.every((check) => check.pass)).toBe(true);
  });

  test("stops honestly after three failed attempts", async () => {
    const output = join(root, "exhausted.mp4");
    const run = await runWithRepair({
      initialPlan: attemptPlan(output, true),
      profile,
      inputPaths: [source],
      repair: async () => attemptPlan(output, true),
    });
    expect(run.all_pass).toBe(false);
    expect(run.events).toHaveLength(3);
    expect(run.events.every((event) => event.outcome.status === "verification_failed")).toBe(true);
    expect(run.checks.some((check) => !check.pass)).toBe(true);
    expect(existsSync(output)).toBe(false);
  });

  test("rejects a repair that weakens verification", async () => {
    const output = join(root, "weakened.mp4");
    await expect(runWithRepair({
      initialPlan: attemptPlan(output, true),
      profile,
      inputPaths: [source],
      repair: async () => ({
        ...attemptPlan(output, false),
        checks: [{ type: "plays", target: true }],
      }),
    })).rejects.toThrow("preserve every verification check");
  });

  test("rejects a repair that renames the recipe", async () => {
    const output = join(root, "renamed.mp4");
    await expect(runWithRepair({
      initialPlan: attemptPlan(output, true), profile, inputPaths: [source],
      repair: async () => ({ ...attemptPlan(output, false), name: "renamed-recipe" }),
    })).rejects.toThrow("preserve the canonical recipe name");
  });
});
