import { describe, expect, test } from "bun:test";
import {
  compositionCompatibility, deriveCompositionContract, type CompositionContract,
  type ContractSource,
} from "./composition-contract.ts";
import { load } from "./recipes.ts";

const recipes = load();

function contract(name: string): CompositionContract {
  const recipe = recipes.find((candidate) => candidate.name === name);
  if (!recipe) throw new Error(`missing recipe: ${name}`);
  const derived = deriveCompositionContract(recipe);
  if (!derived) throw new Error(`recipe is not composition eligible: ${name}`);
  return derived;
}

function pandoc(...formatArgs: string[]): ContractSource {
  return {
    tool: "pandoc",
    command_template: {
      commands: [[
        "pandoc", ...formatArgs, "{{input_0}}",
        "-o", "{{input_0_dir}}/{{input_0_stem}}.docx",
      ]],
      output_path: "{{input_0_dir}}/{{input_0_stem}}.docx",
    },
    checks: [
      { type: "file_valid", target: "docx" },
      { type: "format_matches", target: "docx" },
    ],
  };
}

describe("saved-command composition contracts", () => {
  test("derives contracts only from authoritative argv and checks", () => {
    expect(contract("convert-media-to-mp4").output).toEqual({
      family: "media", format: "mp4", streams: ["video", "audio"],
    });
    expect(contract("normalize-audio-to-14-lufs").output).toEqual({
      family: "media", format: "wav", streams: ["audio"],
    });
    expect(contract("ocr-scanned-pdf")).toMatchObject({
      input: {
        family: "document", accepted_formats: ["pdf"], required_pdf_text_layer: "absent",
      },
      output: { family: "document", format: "pdf", pdf_text_layer: "present" },
    });
    expect(contract("transcribe-video-to-srt").output).toEqual({
      family: "subtitle", format: "srt",
    });
    const ambiguousPandoc = recipes.find((recipe) => recipe.name === "convert-markdown-to-docx")!;
    expect(deriveCompositionContract(ambiguousPandoc)).toBeNull();
  });

  test("checks compatible and incompatible format, stream, and PDF contracts", () => {
    expect(compositionCompatibility(
      contract("convert-media-to-mp4").output,
      contract("compress-video-under-25mb").input,
    )).toEqual({ compatible: true });
    expect(compositionCompatibility(
      contract("normalize-audio-to-14-lufs").output,
      contract("compress-video-under-25mb").input,
    )).toEqual({ compatible: false, reason: "streams" });
    expect(compositionCompatibility(
      contract("ocr-scanned-pdf").output,
      contract("ocr-scanned-pdf").input,
    )).toEqual({ compatible: false, reason: "pdf_text_layer" });
  });

  test("narrows explicit Pandoc input formats", () => {
    const markdown = deriveCompositionContract(pandoc("-f", "markdown"));
    expect(markdown?.input).toEqual({ family: "document", accepted_formats: ["md"] });
    expect(deriveCompositionContract(pandoc("--from=markdown"))?.input)
      .toEqual({ family: "document", accepted_formats: ["md"] });
    expect(compositionCompatibility(
      { family: "document", format: "md" }, markdown!.input,
    )).toEqual({ compatible: true });
    expect(compositionCompatibility(
      { family: "document", format: "pdf", pdf_text_layer: "unknown" }, markdown!.input,
    )).toEqual({ compatible: false, reason: "format" });
  });

  test("rejects contradictory, unsupported, and ambiguous declarations", () => {
    expect(deriveCompositionContract(pandoc("-f", "markdown", "--from", "html"))).toBeNull();
    expect(deriveCompositionContract(pandoc("-f", "rst"))).toBeNull();
    expect(deriveCompositionContract(pandoc())).toBeNull();
    const contradictory = pandoc("-f", "markdown");
    contradictory.command_template.output_path = "{{input_0_dir}}/{{input_0_stem}}.pdf";
    expect(deriveCompositionContract(contradictory)).toBeNull();
  });

  test("rejects ambiguous or multi-input commands without names or task text", () => {
    expect(deriveCompositionContract({
      tool: "ffmpeg",
      command_template: {
        commands: [["ffmpeg", "-i", "{{input_0}}", "{{input_0_dir}}/out.bin"]],
        output_path: "{{input_0_dir}}/out.bin",
      },
      checks: [{ type: "plays", target: true }],
    })).toBeNull();
    expect(deriveCompositionContract({
      tool: "ffmpeg",
      command_template: {
        commands: [[
          "ffmpeg", "-i", "{{input_0}}", "-i", "{{input_1}}",
          "{{input_0_dir}}/out.mp4",
        ]],
        output_path: "{{input_0_dir}}/out.mp4",
      },
      checks: [{ type: "streams_present", target: "video,audio" }],
    })).toBeNull();
  });
});
