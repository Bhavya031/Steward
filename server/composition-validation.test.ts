import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildComposition } from "./composition-builder.ts";
import type { CompositionRecipe, CompositionStage } from "./recipe-types.ts";
import { validateSavedRecipe } from "./recipe-validation.ts";
import { RECIPES_DIRECTORY } from "./recipes.ts";

const root = mkdtempSync(join(tmpdir(), "steward-composition-validation-"));
const catalog = join(root, "catalog");
mkdirSync(catalog);
for (const file of readdirSync(RECIPES_DIRECTORY).filter((name) => name.endsWith(".json"))) {
  copyFileSync(join(RECIPES_DIRECTORY, file), join(catalog, file));
}
afterAll(() => rmSync(root, { recursive: true, force: true }));

function composition(): CompositionRecipe {
  return buildComposition({
    name: "convert-then-compress",
    workflow_ids: ["convert-media-to-mp4", "compress-video-under-25mb"],
    arch: "arm64",
  }, catalog);
}

function withStages(stages: CompositionStage[]): CompositionRecipe {
  return {
    ...composition(),
    stages,
    composition_contract: {
      input: stages[0]!.composition_contract.input,
      output: stages.at(-1)!.composition_contract.output,
    },
  };
}

function repeatedStages(count: number, commands = 1): CompositionStage[] {
  const source = composition().stages[0]!;
  return Array.from({ length: count }, (_, index) => ({
    ...structuredClone(source),
    source_id: `stable-stage-${index}`,
    command_template: {
      ...structuredClone(source.command_template),
      commands: Array.from(
        { length: commands },
        () => [...source.command_template.commands[0]!],
      ),
    },
  }));
}

describe("composition recipe validation", () => {
  test("rejects malformed discriminators, unknown fields, and nested records", () => {
    const malformed = { ...composition(), kind: "compositon" };
    expect(() => validateSavedRecipe(malformed)).toThrow("recipe shape is invalid");
    const malformedAtomic = {
      ...JSON.parse(readFileSync(join(catalog, "convert-media-to-mp4.json"), "utf8")),
      kind: "atom",
    };
    expect(() => validateSavedRecipe(malformedAtomic)).toThrow("recipe shape is invalid");
    const unknown = { ...composition(), unexpected: true };
    expect(() => validateSavedRecipe(unknown)).toThrow("shape is invalid");
    const atomicUnknown = {
      ...JSON.parse(readFileSync(join(catalog, "convert-media-to-mp4.json"), "utf8")),
      unexpected: true,
    };
    expect(() => validateSavedRecipe(atomicUnknown)).toThrow("recipe shape is invalid");
    const nested = structuredClone(composition()) as unknown as Record<string, unknown>;
    (nested.stages as Array<Record<string, unknown>>)[0]!.stages = [];
    expect(() => validateSavedRecipe(nested)).toThrow("shape is invalid");
  });

  test("accepts exactly 8 stages and rejects 1 or 9", () => {
    expect(() => validateSavedRecipe(withStages(repeatedStages(1)))).toThrow("2 to 8 stages");
    expect(validateSavedRecipe(withStages(repeatedStages(8)))).toMatchObject({
      kind: "composition", stages: expect.any(Array),
    });
    expect(() => validateSavedRecipe(withStages(repeatedStages(9)))).toThrow("2 to 8 stages");
  });

  test("accepts 8 total commands and rejects more than 8", () => {
    expect(() => validateSavedRecipe(withStages(repeatedStages(4, 2)))).not.toThrow();
    expect(() => validateSavedRecipe(withStages(repeatedStages(5, 2))))
      .toThrow("at most 8 argv arrays");
  });

  test("accepts exactly 64 KiB and rejects 64 KiB plus one byte", () => {
    const exact = composition();
    let remaining = 64 * 1_024 - Buffer.byteLength(JSON.stringify(exact), "utf8");
    if (remaining % 2 !== 0) {
      exact.arch = "x86_64";
      remaining -= 1;
    }
    const original = exact.stages[0]!.command_template.output_path;
    const padded = original.replace(".mp4", `${"a".repeat(remaining / 2)}.mp4`);
    exact.stages[0]!.command_template.output_path = padded;
    exact.stages[0]!.command_template.commands[0]!.splice(-1, 1, padded);
    expect(Buffer.byteLength(JSON.stringify(exact), "utf8")).toBe(64 * 1_024);
    expect(() => validateSavedRecipe(exact)).not.toThrow();
    const oversized = structuredClone(exact);
    oversized.created_at += " ";
    expect(() => validateSavedRecipe(oversized)).toThrow("64 KiB persisted-size limit");
  });

  test("re-derives stage and aggregate contracts", () => {
    const stage = structuredClone(composition());
    stage.stages[0]!.composition_contract.output = {
      family: "media", format: "wav", streams: ["audio"],
    };
    expect(() => validateSavedRecipe(stage)).toThrow("does not match the validated command and checks");
    const aggregate = structuredClone(composition());
    aggregate.composition_contract.output = {
      family: "media", format: "mov", streams: ["video", "audio"],
    };
    expect(() => validateSavedRecipe(aggregate)).toThrow("does not match its stage snapshots");
  });
});
