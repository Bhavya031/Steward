import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { composition, videoStage } from "./composition-runtime-test-helpers.ts";
import { runComposition } from "./composition-runtime.ts";
import { executePlan, type ExecutionEvent } from "./executor.ts";
import type { Plan } from "./plan.ts";
import { probeSystem } from "./probe.ts";
import { relativeSourceGraph } from "./source-graph.ts";
import { writeY4m } from "./test-fixtures.ts";

const root = mkdtempSync(join(tmpdir(), "steward-composition-runtime-"));
const frame = join(root, "frame.y4m");
const source = join(root, "source.mp4");
const profile = probeSystem();
writeY4m(frame, 2);

beforeAll(async () => {
  const fixture: Plan = {
    name: "composition-fixture",
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

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("verified composition runtime", () => {
  test("chains two verified stages with stage-distinct duplicate evidence", async () => {
    const recipe = composition("two-stage-chain", [
      videoStage({ id: "first-stage", suffix: "first", format: "mov" }),
      videoStage({ id: "second-stage", suffix: "second" }),
    ]);
    const run = await runComposition(recipe, source, { profile });
    expect(run).toMatchObject({ success: true, model_calls: 0 });
    expect(run.stages).toHaveLength(2);
    expect(run.stages[1]!.input_path).toBe(run.stages[0]!.plan.output_path);
    expect(run.stages[1]!.plan.commands.flat()).toContain(run.stages[0]!.plan.output_path);
    const plays = run.stages.flatMap((stage) => stage.checks)
      .filter((check) => check.name === "plays");
    expect(plays.map(({ stage_index, source_id }) => ({ stage_index, source_id }))).toEqual([
      { stage_index: 0, source_id: "first-stage" },
      { stage_index: 1, source_id: "second-stage" },
    ]);
    expect(existsSync(dirname(run.stages[0]!.plan.output_path))).toBe(false);
    expect(existsSync(run.output_path!)).toBe(true);
  });

  test("chains three stages and cleans composition and stage-intermediate roots", async () => {
    const events: ExecutionEvent[] = [];
    const recipe = composition("three-stage-chain", [
      videoStage({ id: "stage-one", suffix: "one", format: "mkv" }),
      videoStage({ id: "stage-two", suffix: "two", format: "mov", intermediate: true }),
      videoStage({ id: "stage-three", suffix: "three" }),
    ]);
    const run = await runComposition(recipe, source, {
      profile,
      executionOptions: { onEvent: (event) => events.push(event) },
    });
    expect(run.success).toBe(true);
    expect(run.stages).toHaveLength(3);
    expect(run.stages.slice(1).every((stage, index) =>
      stage.input_path === run.stages[index]!.plan.output_path
    )).toBe(true);
    const intermediate = events.flatMap((event) => event.type === "started" ? event.argv : [])
      .find((argument) => argument.includes("steward-run-"));
    expect(intermediate).toBeString();
    expect(existsSync(dirname(intermediate!))).toBe(false);
    expect(existsSync(dirname(run.stages[0]!.plan.output_path))).toBe(false);
  });

  test("recomputes a derivation from the stage's actual input", async () => {
    const derivations = {
      video_bitrate: {
        name: "size_target_video_bitrate" as const,
        args: { target_bytes: 300_000, audio_kbps: 32, safety_factor: 0.9 },
      },
    };
    const recipe = composition("derived-stage-chain", [
      videoStage({
        id: "short-stage", suffix: "short",
        args: ["-t", "0.4", "-c:v", "libx264", "-pix_fmt", "yuv420p"],
      }),
      videoStage({
        id: "derived-stage", suffix: "derived", derivations,
        args: ["-c:v", "libx264", "-b:v", "{{video_bitrate}}", "-pix_fmt", "yuv420p"],
      }),
    ]);
    const run = await runComposition(recipe, source, { profile });
    const command = run.stages[1]!.plan.commands[0]!;
    const bitrate = Number.parseInt(command[command.indexOf("-b:v") + 1]!, 10);
    expect(run.success).toBe(true);
    expect(run.stages[1]!.input_path).toBe(run.stages[0]!.plan.output_path);
    expect(bitrate).toBeGreaterThan(3_000);
  });

  test("uses deterministic final collision suffixes beside the original input", async () => {
    const recipe = composition("collision-chain", [
      videoStage({ id: "collision-one", suffix: "collision-one", format: "mov" }),
      videoStage({ id: "collision-two", suffix: "collision-two" }),
    ]);
    const first = await runComposition(recipe, source, { profile });
    const second = await runComposition(recipe, source, { profile });
    const extension = extname(first.output_path!);
    const stem = basename(first.output_path!, extension);
    expect(dirname(first.output_path!)).toBe(realpathSync(dirname(source)));
    expect(second.output_path).toBe(join(realpathSync(dirname(source)), `${stem}-2${extension}`));
  });

  test("runtime module graph cannot reach planner, agent, Codex, or GPT", () => {
    const graph = relativeSourceGraph(
      resolve(import.meta.dir, "composition-runtime.ts"),
      resolve(import.meta.dir, ".."),
    );
    const modules = [...graph.keys()];
    expect(modules).toContain("server/executor.ts");
    expect(modules).toContain("server/verify/index.ts");
    expect(modules.some((name) => name.includes("agent") || name.includes("repair-loop"))).toBe(false);
    expect([...graph.values()].join("\n")).not.toMatch(/\bCodex\b|\bgpt-[a-z0-9.-]+/i);
  });
});
