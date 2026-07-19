import { describe, expect, test } from "bun:test";
import type { AtomicRecipe } from "./recipe-types.ts";
import { validateRecipe } from "./recipe-validation.ts";
import { load } from "./recipes.ts";

function recipe(name: string): AtomicRecipe {
  const found = load().find((candidate) => candidate.name === name);
  if (!found) throw new Error(`missing recipe: ${name}`);
  return structuredClone(found);
}

describe("portable recipe snapshot paths", () => {
  test.each([
    "/Users/private/input.mov",
    "../private/input.mov",
    "./input.mov",
    "relative/private.mov",
    "input.mov",
  ])("rejects a non-slot command input path: %s", (path) => {
    const candidate = recipe("convert-media-to-mp4");
    candidate.command_template.commands[0]![2] = path;
    expect(() => validateRecipe(candidate)).toThrow("authorized portable slot");
  });

  test.each([
    "/Users/private/output.mp4",
    "../private/output.mp4",
    "./output.mp4",
    "relative/private.mp4",
    "output.mp4",
  ])("rejects a non-slot command output path: %s", (path) => {
    const candidate = recipe("convert-media-to-mp4");
    candidate.command_template.commands[0]!.splice(-1, 1, path);
    candidate.command_template.output_path = path;
    expect(() => validateRecipe(candidate)).toThrow("first input directory");
  });

  test.each([
    "/Users/private/source.mov",
    "../private/source.mov",
    "./source.mov",
    "relative/private.mov",
    "source.mov",
  ])("rejects a non-slot source check target: %s", (path) => {
    const candidate = recipe("convert-media-to-mp4");
    const check = candidate.checks.find(({ type }) => type === "duration_matches");
    if (!check) throw new Error("duration check is missing");
    check.target = path;
    expect(() => validateRecipe(candidate)).toThrow("authorized input slot");
  });

  test("accepts declared intermediates and trusted resource slots", () => {
    expect(() => validateRecipe(recipe("transcribe-video-to-srt"))).not.toThrow();
  });

  test("preserves legitimate non-path arguments containing slashes", () => {
    const ghostscript: AtomicRecipe = {
      name: "compress-pdf",
      command_template: {
        commands: [[
          "gs", "-dSAFER", "-dBATCH", "-dNOPAUSE", "-sDEVICE=pdfwrite",
          "-dPDFSETTINGS=/screen",
          "-sOutputFile={{input_0_dir}}/{{input_0_stem}}-small.pdf",
          "{{input_0}}",
        ]],
        output_path: "{{input_0_dir}}/{{input_0_stem}}-small.pdf",
      },
      checks: [
        { type: "file_valid", target: "pdf" },
        { type: "format_matches", target: "pdf" },
      ],
      created_at: "2026-07-19T06:30:00.000Z",
      arch: "arm64",
      tool: "gs",
      install_weight: "light",
    };
    expect(() => validateRecipe(ghostscript)).not.toThrow();
  });
});
