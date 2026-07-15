import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plan } from "./plan.ts";
import { save } from "./recipes.ts";

const root = mkdtempSync(join(tmpdir(), "steward-recipe-integrity-"));
const source = join(root, "source.wav");
const output = join(root, "source-normalized.wav");
const mediaSource = join(root, "clip.mkv");
const mediaOutput = join(root, "clip.mp4");
writeFileSync(source, "fixture");
writeFileSync(mediaSource, "fixture");
afterAll(() => rmSync(root, { recursive: true, force: true }));

function plan(filter: string): Plan {
  return {
    tool: "ffmpeg", install_cmd: null,
    commands: [["ffmpeg", "-i", source, "-af", filter, output]],
    output_path: output,
    checks: [
      { type: "loudness_matches", target: -14 },
      { type: "true_peak_under", target: -1 },
      { type: "duration_matches", target: source },
      { type: "audio_stream_present", target: true },
    ],
  };
}

function savePlan(candidate: Plan, directory: string) {
  return save({
    name: "normalize-audio-to-14-lufs", replaced_service: "Podcast loudness SaaS",
    monthly_price: 10, plan: candidate, inputPaths: [source], arch: "arm64",
    verification: candidate.checks.map((check) => ({
      name: check.type, pass: true, expected: "expected", actual: "measured",
    })),
  }, directory);
}

describe("recipe plan integrity", () => {
  test.each(["measured_I=-20", "measured_TP=-3", "measured_LRA=2", "measured_thresh=-30"])(
    "refuses a baked loudnorm field: %s", (field) => {
      const directory = join(root, field.replace("=", "-"));
      expect(() => savePlan(
        plan(`loudnorm=I=-14:TP=-1:LRA=11:${field}`), directory,
      )).toThrow("recipe refused: plan contains file-specific loudnorm measured values");
      expect(existsSync(directory)).toBe(false);
    },
  );

  test("stores the authored loudnorm algorithm unchanged except path slots", () => {
    const filter = "loudnorm=I=-14:TP=-1:LRA=11";
    const recipe = savePlan(plan(filter), join(root, "single-pass"));
    expect(recipe?.command_template.commands).toEqual([[
      "ffmpeg", "-i", "{{input_0}}", "-af", filter,
      "{{input_0_dir}}/{{input_0_stem}}-normalized.wav",
    ]]);
  });

  test("stores a concrete media plan without inventing formats, streams, or codecs", () => {
    const mediaPlan: Plan = {
      tool: "ffmpeg", install_cmd: null,
      commands: [["ffmpeg", "-i", mediaSource, mediaOutput]], output_path: mediaOutput,
      checks: [
        { type: "format_matches", target: "mp4" },
        { type: "duration_matches", target: mediaSource },
        { type: "streams_present", target: "video,audio" },
      ],
    };
    const recipe = save({
      name: "convert-media-to-mp4", replaced_service: "CloudConvert", monthly_price: 9,
      plan: mediaPlan, inputPaths: [mediaSource], arch: "arm64",
      verification: mediaPlan.checks.map((check) => ({
        name: check.type, pass: true, expected: "expected", actual: "measured",
      })),
    }, join(root, "media"));
    expect(recipe?.command_template.commands).toEqual([[
      "ffmpeg", "-i", "{{input_0}}", "{{input_0_dir}}/{{input_0_stem}}.mp4",
    ]]);
    expect(recipe?.checks).toEqual([
      { type: "format_matches", target: "mp4" },
      { type: "duration_matches", target: "{{input_0}}" },
      { type: "streams_present", target: "video,audio" },
    ]);
  });
});
