import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateCommandPaths } from "./path-policy.ts";
import { validatePlan, type Plan } from "./plan.ts";
import { renderRecipe, save } from "./recipes.ts";

const root = mkdtempSync(join(tmpdir(), "steward-subtitles-"));
const source = join(root, "source.mp4");
const model = join(root, "trusted-model.bin");
const output = join(root, "source-subtitles.srt");
writeFileSync(source, "media");
writeFileSync(model, "model");
afterAll(() => rmSync(root, { recursive: true, force: true }));

function subtitlePlan(): Plan {
  return validatePlan({
    name: "generate-srt-subtitles",
    tool: "whisper-cli",
    install_cmd: null,
    commands: [
      ["ffmpeg", "-i", source, "-vn", "-ac", "1", "-ar", "16000",
        "-c:a", "pcm_s16le", "-f", "wav", "{{temp_dir}}/audio.wav"],
      ["whisper-cli", "-m", "{{resource_whisper_large_v3_turbo}}",
        "-f", "{{temp_dir}}/audio.wav", "-l", "auto", "-osrt", "--print-progress",
        "-of", output.slice(0, -4)],
    ],
    output_path: output,
    checks: [
      { type: "srt_valid", target: true },
      { type: "cue_count", target: 1 },
      { type: "timestamps_monotonic", target: true },
    ],
    intermediates: ["{{temp_dir}}/audio.wav"],
    resources: ["whisper-large-v3-turbo"],
  });
}

describe("subtitle plan contracts", () => {
  test("allows an allowlisted ancillary tool but keeps whisper as the final primary tool", () => {
    expect(subtitlePlan().commands.map((command) => command[0])).toEqual(["ffmpeg", "whisper-cli"]);
    expect(() => validatePlan({
      ...subtitlePlan(),
      commands: [...subtitlePlan().commands].reverse(),
    })).toThrow("final command");
  });

  test("grants only the pinned model and maps -of prefix to the declared SRT", () => {
    const command = ["whisper-cli", "-m", model, "-f", source, "-osrt", "-of", output.slice(0, -4)];
    expect(() => validateCommandPaths(
      "whisper-cli", command, [source], output, { trustedInputs: [model] },
    )).not.toThrow();
    expect(() => validateCommandPaths("whisper-cli", command, [source], output)).toThrow(
      "not explicitly granted",
    );
    command[command.length - 1] = join(root, "wrong-prefix");
    expect(() => validateCommandPaths(
      "whisper-cli", command, [source], output, { trustedInputs: [model] },
    )).toThrow("not explicitly granted");
  });

  test("stores and rerenders the identical two-tool plan with portable paths", () => {
    const plan = subtitlePlan();
    const directory = join(root, "recipes");
    const recipe = save({
      plan, inputPaths: [source], arch: "arm64",
      verification: plan.checks.map((check) => ({
        name: check.type, pass: true, expected: "expected", actual: "actual",
      })),
    }, directory);
    if (!recipe) throw new Error("saved command was refused");
    const fresh = join(root, "fresh.mov");
    const rendered = renderRecipe(recipe, [fresh]);
    expect(rendered.commands.map((command) => command[0])).toEqual(["ffmpeg", "whisper-cli"]);
    expect(rendered.commands[1]?.at(-1)).toBe(join(root, "fresh-subtitles"));
    expect(rendered.output_path).toBe(join(root, "fresh-subtitles.srt"));
    expect(JSON.parse(readFileSync(
      join(directory, "generate-srt-subtitles.json"), "utf8",
    )).resources).toEqual(["whisper-large-v3-turbo"]);
  });
});
