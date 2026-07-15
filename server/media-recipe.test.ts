import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mediaTargetFromTask } from "./media-formats.ts";
import type { Plan } from "./plan.ts";
import { match, renderRecipe, save } from "./recipes.ts";

const root = mkdtempSync(join(tmpdir(), "steward-media-recipe-"));
const source = join(root, "source.mkv");
const output = join(root, "source-converted.mp4");
writeFileSync(source, "fixture");
afterAll(() => rmSync(root, { recursive: true, force: true }));

function conversionPlan(): Plan {
  return {
    tool: "ffmpeg", install_cmd: null,
    commands: [["ffmpeg", "-i", source, "-c:v", "libx264", "-c:a", "aac", output]],
    output_path: output,
    checks: [
      { type: "format_matches", target: "mp4" },
      { type: "duration_matches", target: source },
      { type: "streams_present", target: "video,audio" },
    ],
  };
}

describe("general media conversion recipe", () => {
  test("stores target format, stream, and argv slots without machine paths", () => {
    const plan = conversionPlan();
    const directory = join(root, "recipes");
    const recipe = save({
      name: "convert-video-audio", replaced_service: "CloudConvert", monthly_price: 9,
      plan, inputPaths: [source], arch: "arm64",
      verification: plan.checks.map((check) => ({
        name: check.type, pass: true, expected: "fixture", actual: "fixture",
      })),
    }, directory);
    if (!recipe) throw new Error("media recipe did not save");
    expect(JSON.stringify(recipe)).not.toContain(root);
    expect(recipe.command_template.commands).toEqual([[
      "ffmpeg", "-i", "{{input_0}}", "{{media_args}}",
      "{{input_0_dir}}/{{input_0_stem}}-converted.{{target_format}}",
    ]]);
    expect(recipe.checks[0]?.target).toBe("{{target_format}}");
    expect(recipe.checks[2]?.target).toBe("{{target_streams}}");
    const second = join(root, "second.mkv");
    const rendered = renderRecipe(recipe, [second], {
      target_format: "webm", target_streams: "video,audio",
      media_args: ["-c:v", "libvpx-vp9", "-c:a", "libopus"],
    });
    expect(rendered.output_path).toBe(join(root, "second-converted.webm"));
    expect(rendered.commands[0]).toContain("libvpx-vp9");
    expect(rendered.checks[0]?.target).toBe("webm");
    expect(match("convert this video to mov", [second], directory)?.recipe.name).toBe(
      "convert-video-audio",
    );
  });

  test("extracts supported target formats locally from ordinary tasks", () => {
    expect(mediaTargetFromTask("turn this into a MOV I can use in Resolve")).toBe("mov");
    expect(mediaTargetFromTask("convert my recording to webm please")).toBe("webm");
    expect(mediaTargetFromTask("make it smaller")).toBeNull();
  });
});
