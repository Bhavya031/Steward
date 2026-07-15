import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executePlan, type ExecutionEvent } from "../executor.ts";
import type { Plan } from "../plan.ts";
import { probeSystem } from "../probe.ts";
import { verifyChecks, type VerificationContext } from "./index.ts";
import { writeWav, writeY4m } from "../test-fixtures.ts";

const root = mkdtempSync(join(tmpdir(), "steward-audio-verify-"));
const profile = probeSystem();
const source = join(root, "source.wav");
const normalized = join(root, "normalized.wav");
const loud = join(root, "loud.wav");
const silent = join(root, "silent.wav");
const videoOnly = join(root, "video-only.mp4");
const frame = join(root, "video.y4m");

function plan(output: string, args: string[]): Plan {
  return {
    tool: "ffmpeg", install_cmd: null,
    commands: [["ffmpeg", "-loglevel", "error", ...args, output]],
    output_path: output,
    checks: [{ type: "audio_stream_present", target: true }],
  };
}

async function generate(output: string, args: string[], inputs: string[] = []): Promise<void> {
  const execution = await executePlan(plan(output, args), profile, inputs);
  if (!execution.ok) throw new Error(`fixture generation failed: ${execution.stderr_tail}`);
}

beforeAll(async () => {
  writeWav(source, 3, { frequency: 1_000, amplitude: 0.2 });
  writeWav(loud, 2, { frequency: 800, amplitude: 0.99 });
  writeWav(silent, 2, { amplitude: 0, channels: 2 });
  writeY4m(frame, 2);
  await generate(normalized, [
    "-i", source, "-af", "loudnorm=I=-14:TP=-2:LRA=7", "-c:a", "pcm_s24le",
  ], [source]);
  await generate(videoOnly, [
    "-i", frame,
    "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p",
  ], [frame]);
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

function context(
  outputPath: string,
  sourcePaths = [source],
  onExecutionEvent?: (event: ExecutionEvent) => void,
): VerificationContext {
  return { outputPath, sourcePaths, profile, onExecutionEvent };
}

describe("audio verification", () => {
  test("all checks pass with evidence and one shared loudness scan", async () => {
    const events: ExecutionEvent[] = [];
    const checks = await verifyChecks([
      { type: "audio_stream_present", target: true },
      { type: "loudness_matches", target: -14 },
      { type: "true_peak_under", target: -1 },
      { type: "duration_matches", target: source },
    ], context(normalized, [source], (event) => events.push(event)));
    expect(checks.map((check) => check.name)).toEqual([
      "audio_stream_present", "loudness_matches", "true_peak_under", "duration_matches",
    ]);
    expect(checks.every((check) => check.pass)).toBe(true);
    expect(checks[0]?.actual).toMatch(/^pcm_s24le, 1ch, \d+Hz$/);
    expect(checks[1]?.expected).toBe("target -14.0 LUFS ±1.0");
    expect(checks[1]?.actual).toMatch(/^measured -1[34]\.\d LUFS \(Δ [01]\.\d LUFS\)$/);
    expect(checks[2]?.actual).toMatch(/^measured -\d+\.\d dBTP$/);
    expect(checks[3]?.actual).toMatch(/3\.000 s \(Δ 0\.000 s\)/);
    const scans = events.filter((event) =>
      event.type === "started" && event.argv.includes("loudnorm=print_format=json")
    );
    expect(scans).toHaveLength(1);
    expect(scans[0]?.type === "started" ? scans[0].argv : []).toEqual([
      "ffmpeg", "-hide_banner", "-nostdin", "-i", realpathSync(normalized),
      "-vn", "-af", "loudnorm=print_format=json", "-f", "null", "-",
    ]);
  });

  test("audio_stream_present fails with measured absence", async () => {
    const [check] = await verifyChecks(
      [{ type: "audio_stream_present", target: true }], context(videoOnly),
    );
    expect(check).toEqual({
      name: "audio_stream_present", pass: false,
      expected: "at least one audio stream", actual: "no audio streams detected",
    });
  });

  test("loudness mismatch and silence fail cleanly with evidence", async () => {
    const [mismatch] = await verifyChecks(
      [{ type: "loudness_matches", target: -20 }], context(normalized),
    );
    expect(mismatch?.pass).toBe(false);
    expect(mismatch?.actual).toMatch(/measured -1[34]\.\d LUFS \(Δ [5-7]\.\d LUFS\)/);
    const [silence] = await verifyChecks(
      [{ type: "loudness_matches", target: -14 }], context(silent),
    );
    expect(silence?.pass).toBe(false);
    expect(silence?.actual).toContain("silent/near-silent audio; measured -inf LUFS");
  });

  test("true_peak_under fails near clipping with measured dBTP", async () => {
    const [check] = await verifyChecks(
      [{ type: "true_peak_under", target: -1 }], context(loud),
    );
    expect(check?.pass).toBe(false);
    expect(check?.expected).toBe("at or below -1.0 dBTP");
    expect(check?.actual).toMatch(/^measured -?0\.\d dBTP$/);
  });

  test("duration_matches shares video evidence and fails over tolerance", async () => {
    const [check] = await verifyChecks(
      [{ type: "duration_matches", target: source }], context(loud),
    );
    expect(check?.pass).toBe(false);
    expect(check?.expected).toBe("3.000 s ±0.500 s");
    expect(check?.actual).toBe("2.000 s (Δ 1.000 s)");
  });
});
