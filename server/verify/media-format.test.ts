import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executePlan } from "../executor.ts";
import type { Plan } from "../plan.ts";
import { probeSystem } from "../probe.ts";
import { writeWav, writeY4m } from "../test-fixtures.ts";
import { verifyChecks } from "./index.ts";

const root = mkdtempSync(join(tmpdir(), "steward-media-format-"));
const video = join(root, "video.y4m");
const audio = join(root, "audio.wav");
const mp4 = join(root, "converted.mp4");
const mov = join(root, "converted.mov");
const webm = join(root, "converted.webm");
const profile = probeSystem();
writeY4m(video, 1);
writeWav(audio, 1);

function plan(output: string, videoCodec: string, audioCodec: string): Plan {
  return {
    tool: "ffmpeg", install_cmd: null,
    commands: [["ffmpeg", "-i", video, "-i", audio,
      "-c:v", videoCodec, "-c:a", audioCodec, output]],
    output_path: output, checks: [{ type: "format_matches", target: output.split(".").at(-1)! }],
  };
}

beforeAll(async () => {
  for (const fixture of [
    plan(mp4, "libx264", "aac"), plan(mov, "libx264", "aac"),
    plan(webm, "libvpx-vp9", "libopus"),
  ]) {
    const execution = await executePlan(fixture, profile, [video, audio]);
    if (!execution.ok) throw new Error(execution.stderr_tail);
  }
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("media format verification", () => {
  test.each([[mp4, "mp4", "MP4"], [mov, "mov", "MOV"], [webm, "webm", "WEBM"]])(
    "detects %s structurally as %s", async (output, target, label) => {
      const [check] = await verifyChecks([{ type: "format_matches", target }], {
        outputPath: output, sourcePaths: [video, audio], profile,
      });
      expect(check?.pass).toBe(true);
      expect(check?.actual).toContain(`${label} container`);
    },
  );

  test("fails when the measured container differs from the promised format", async () => {
    const [check] = await verifyChecks([{ type: "format_matches", target: "mov" }], {
      outputPath: mp4, sourcePaths: [video, audio], profile,
    });
    expect(check?.pass).toBe(false);
    expect(check?.expected).toBe("MOV");
    expect(check?.actual).toContain("MP4 container");
  });
});
