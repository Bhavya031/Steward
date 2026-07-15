import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, rmSync, statSync, truncateSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executePlan } from "../executor.ts";
import type { Plan } from "../plan.ts";
import { probeSystem } from "../probe.ts";
import { verifyChecks, type VerificationContext } from "./index.ts";

const root = mkdtempSync(join(tmpdir(), "steward-video-verify-"));
const profile = probeSystem();
const source = join(root, "source.mp4");
const valid = join(root, "valid.mp4");
const longer = join(root, "longer.mp4");
const videoOnly = join(root, "video-only.mp4");
const truncated = join(root, "truncated.mp4");

afterAll(() => rmSync(root, { recursive: true, force: true }));

function fixturePlan(output: string, duration: number, audio: boolean): Plan {
  const command = [
    "ffmpeg", "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc=size=64x64:rate=10",
  ];
  if (audio) command.push("-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100");
  command.push("-t", String(duration), "-c:v", "libx264", "-pix_fmt", "yuv420p");
  if (audio) command.push("-c:a", "aac");
  command.push(output);
  return {
    tool: "ffmpeg",
    install_cmd: null,
    command,
    output_path: output,
    checks: [{ type: "plays", target: true }],
  };
}

beforeAll(async () => {
  for (const plan of [
    fixturePlan(source, 1, true),
    fixturePlan(longer, 2, true),
    fixturePlan(videoOnly, 1, false),
  ]) {
    const execution = await executePlan(plan, profile, []);
    if (!execution.ok) throw new Error(`fixture generation failed: ${execution.stderr_tail}`);
  }
  copyFileSync(source, valid);
  copyFileSync(source, truncated);
  truncateSync(truncated, Math.floor(statSync(truncated).size / 3));
});

function context(outputPath: string, sourcePaths = [source]): VerificationContext {
  return { outputPath, sourcePaths, profile };
}

describe("video verification", () => {
  test("passes all video checks with measured evidence and preserves order", async () => {
    const results = await verifyChecks([
      { type: "size_under", target: statSync(valid).size + 1 },
      { type: "duration_matches", target: source },
      { type: "streams_present", target: "video,audio" },
      { type: "plays", target: true },
    ], context(valid));

    expect(results.map((check) => check.name)).toEqual([
      "size_under", "duration_matches", "streams_present", "plays",
    ]);
    expect(results.every((check) => check.pass)).toBe(true);
    expect(results[0]?.actual).toContain("bytes");
    expect(results[1]?.actual).toMatch(/s \(Δ \d+\.\d{3} s\)/);
    expect(results[2]?.actual).toContain("video (h264)");
    expect(results[2]?.actual).toContain("audio (aac)");
    expect(results[3]?.actual).toContain("frames; ffprobe exit 0; no decode errors");
  });

  test("size_under fails with the oversize file's measured bytes", async () => {
    const [check] = await verifyChecks(
      [{ type: "size_under", target: 1 }],
      context(longer),
    );
    expect(check?.pass).toBe(false);
    expect(check?.actual).toContain(`(${statSync(longer).size.toLocaleString("en-US")} bytes)`);
  });

  test("duration_matches fails beyond the half-second tolerance", async () => {
    const [check] = await verifyChecks(
      [{ type: "duration_matches", target: source }],
      context(longer),
    );
    expect(check?.pass).toBe(false);
    expect(check?.actual).toMatch(/2\.000 s \(Δ 1\.000 s\)/);
  });

  test("streams_present fails with the measured missing stream", async () => {
    const [check] = await verifyChecks(
      [{ type: "streams_present", target: "video,audio" }],
      context(videoOnly),
    );
    expect(check?.pass).toBe(false);
    expect(check?.actual).toBe("video (h264)");
  });

  test("plays fails closed on a truncated ffmpeg fixture", async () => {
    const [check] = await verifyChecks(
      [{ type: "plays", target: true }],
      context(truncated),
    );
    expect(check?.pass).toBe(false);
    expect(check?.actual).toContain("ffprobe exit");
    expect(check?.actual).not.toContain("no decode errors");
  });

  test("duration reference must be a granted source", async () => {
    const [check] = await verifyChecks(
      [{ type: "duration_matches", target: longer }],
      context(valid),
    );
    expect(check?.pass).toBe(false);
    expect(check?.actual).toContain("ungranted source");
  });

  test("unknown check types fail closed with evidence", async () => {
    const [check] = await verifyChecks(
      [{ type: "not_a_real_check", target: true }],
      context(valid),
    );
    expect(check).toEqual({
      name: "not_a_real_check",
      pass: false,
      expected: "registered verification check",
      actual: "unsupported check type: not_a_real_check",
    });
  });
});
