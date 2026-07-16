import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEMP_DIR_SLOT } from "./intermediate-policy.ts";
import type { Plan } from "./plan.ts";
import { renderRecipe, save } from "./recipes.ts";

const root = mkdtempSync(join(tmpdir(), "steward-recipe-intermediate-"));
const source = join(root, "source.mp4");
const output = join(root, "source-result.mp4");
const stage = `${TEMP_DIR_SLOT}/stage.mkv`;
writeFileSync(source, "fixture");
afterAll(() => rmSync(root, { recursive: true, force: true }));

const plan: Plan = {
  name: "intermediate-media",
  tool: "ffmpeg", install_cmd: null,
  commands: [
    ["ffmpeg", "-i", source, "-c", "copy", stage],
    ["ffmpeg", "-i", stage, "-c", "copy", output],
  ],
  output_path: output, checks: [{ type: "plays", target: true }],
  intermediates: [stage],
};

describe("recipe intermediates", () => {
  test("stores the authored declarations and renders them unchanged", () => {
    const directory = join(root, "recipes");
    const recipe = save({
      replaced_service: "File converter", monthly_price: 9,
      plan, inputPaths: [source], arch: "arm64",
      verification: [{ name: "plays", pass: true, expected: "decodes", actual: "decoded" }],
    }, directory);
    if (!recipe) throw new Error("green recipe did not save");
    const json = JSON.parse(readFileSync(join(directory, "intermediate-media.json"), "utf8"));
    const rendered = renderRecipe(recipe, [join(root, "fresh.mp4")]);
    expect(json.intermediates).toEqual([stage]);
    expect(rendered.intermediates).toEqual([stage]);
    expect(rendered.commands[0]?.at(-1)).toBe(stage);
    expect(rendered.commands[1]?.[2]).toBe(stage);
  });
});
