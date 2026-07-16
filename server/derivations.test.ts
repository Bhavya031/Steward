import { describe, expect, test } from "bun:test";
import { resolveDerivation, validateDerivations } from "./derivations.ts";
import { parsePlan, type Plan } from "./plan.ts";

const declaration = {
  video_bitrate_kbps: {
    name: "size_target_video_bitrate",
    args: { target_bytes: 25_000_000, audio_kbps: 96, safety_factor: 0.94 },
  },
} as const;
const plan: Plan = {
  name: "compress-video",
  tool: "ffmpeg", install_cmd: null,
  commands: [["ffmpeg", "-i", "/tmp/input.mp4", "/tmp/output.mp4"]],
  output_path: "/tmp/output.mp4", checks: [{ type: "plays", target: true }],
};

describe("named derivations", () => {
  test("resolves the declared size-target formula exactly", () => {
    const trusted = validateDerivations(declaration);
    expect(resolveDerivation(trusted.video_bitrate_kbps!, 10)).toBe("18704k");
  });

  test("rejects unknown function names and invented arguments", () => {
    expect(() => validateDerivations({
      value: { name: "run_javascript", args: {} },
    })).toThrow("unknown derivation name");
    expect(() => validateDerivations({
      value: {
        name: "size_target_video_bitrate",
        args: { ...declaration.video_bitrate_kbps.args, extra: 1 },
      },
    })).toThrow("invalid args");
  });

  test("rejects values outside the documented typed ranges", () => {
    expect(() => validateDerivations({
      value: {
        name: "size_target_video_bitrate",
        args: { target_bytes: 25_000_000, audio_kbps: 96, safety_factor: 1.1 },
      },
    })).toThrow("allowed ranges");
  });

  test("refuses a non-path command slot without a declaration", () => {
    const undeclared = {
      ...plan,
      commands: [["ffmpeg", "-i", "/tmp/input.mp4", "-b:v", "{{video_bitrate_kbps}}", "/tmp/output.mp4"]],
    };
    expect(() => parsePlan(JSON.stringify(undeclared))).toThrow(
      "command slot requires a declared derivation: video_bitrate_kbps",
    );
  });

  test("refuses an unknown derivation name", () => {
    const unknown = {
      ...plan,
      commands: [["ffmpeg", "-i", "/tmp/input.mp4", "-b:v", "{{video_bitrate_kbps}}", "/tmp/output.mp4"]],
      derivations: { video_bitrate_kbps: { name: "arbitrary_code", args: {} } },
    };
    expect(() => parsePlan(JSON.stringify(unknown))).toThrow("unknown derivation name");
  });

  test("accepts a command slot backed by a typed declaration", () => {
    const declared: Plan = {
      ...plan,
      commands: [["ffmpeg", "-i", "/tmp/input.mp4", "-b:v", "{{video_bitrate_kbps}}", "/tmp/output.mp4"]],
      derivations: validateDerivations(declaration),
    };
    expect(parsePlan(JSON.stringify(declared)).derivations).toEqual(declared.derivations!);
  });
});
