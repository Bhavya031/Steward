import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executePlan } from "../executor.ts";
import type { Plan } from "../plan.ts";
import { probeSystem } from "../probe.ts";
import { verifyChecks } from "./index.ts";
import { writeWav, writeY4m } from "../test-fixtures.ts";

const root = mkdtempSync(join(tmpdir(), "steward-fs-regression-"));
const profile = probeSystem();
const source = join(root, "source.mp4");
const capped = join(root, "forced-fs-cap.mp4");
const frame = join(root, "video.y4m");
const tone = join(root, "tone.wav");
writeY4m(frame, 6, 320, 180, 30);
writeWav(tone, 6);

function plan(output: string, cap: boolean): Plan {
  const input = cap
    ? ["-i", source]
    : ["-i", frame, "-i", tone];
  return {
    name: "truncate-video",
    tool: "ffmpeg", install_cmd: null,
    commands: [[
      "ffmpeg", "-loglevel", "error", ...input,
      "-t", "6", "-c:v", "libx264", "-preset", "ultrafast", "-b:v", "4M",
      "-c:a", "aac", "-b:a", "128k",
      ...(cap ? ["-fs", "5000"] : []), output,
    ]],
    output_path: output,
    checks: [{ type: "duration_matches", target: source }],
  };
}

beforeAll(async () => {
  const generated = await executePlan(plan(source, false), profile, [frame, tone]);
  if (!generated.ok) throw new Error(generated.stderr_tail);
  const forced = await executePlan(plan(capped, true), profile, [source]);
  if (!forced.ok) throw new Error(forced.stderr_tail);
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("file cap regression", () => {
  test("forced -fs truncation fails duration verification with measured evidence", async () => {
    const [check] = await verifyChecks(
      [{ type: "duration_matches", target: source }],
      { outputPath: capped, sourcePaths: [source], profile },
    );
    expect(check?.pass).toBe(false);
    expect(check?.expected).toContain("6.000 s");
    expect(check?.actual).toMatch(/s \(Δ [1-9]\d*\.\d{3} s\)/);
  });
});
