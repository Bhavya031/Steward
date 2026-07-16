import { describe, expect, spyOn, test } from "bun:test";
import type { Plan } from "./plan.ts";
import type { Recipe } from "./recipe-types.ts";
import { load } from "./recipes.ts";
import { killTotalFor, replacementClaimFor } from "./replacement-prices.ts";
import { printRecipeCard } from "./terminal.ts";

const cases = [
  ["ffmpeg", "size_under", "Clideo", 9],
  ["ffmpeg", "format_matches", "CloudConvert", 8],
  ["ffmpeg", "loudness_matches", "Auphonic", 11],
  ["pandoc", "format_matches", "Convertio", 6.99],
] as const;

function plan(tool: Plan["tool"], type: Plan["checks"][number]["type"]): Plan {
  const target = type === "size_under" ? 1_000 : type === "loudness_matches" ? -14
    : type === "format_matches" && tool === "ffmpeg" ? "mp4" : "docx";
  return {
    name: "test-replacement", tool, install_cmd: null,
    commands: [[tool, "/tmp/input", "/tmp/output"]], output_path: "/tmp/output",
    checks: [{ type, target }],
  };
}

describe("curated replacement prices", () => {
  test.each(cases)("maps %s + %s to an approved claim", (tool, type, service, price) => {
    expect(replacementClaimFor(plan(tool, type))).toEqual({
      replaced_service: service, monthly_price: price,
    });
  });

  test("returns no claim for an unknown tool/check class", () => {
    expect(replacementClaimFor(plan("soffice", "file_valid"))).toBeNull();
  });

  test("deduplicates shared services in the shelf kill total", () => {
    const shelf = load();
    expect(shelf.filter((recipe) => recipe.replaced_service === "CloudConvert")).toHaveLength(2);
    expect(killTotalFor(shelf)).toBe(34.99);
  });

  test("an unpriced recipe card renders no replacement claim", () => {
    const unpricedPlan = plan("soffice", "file_valid");
    const recipe: Recipe = {
      name: unpricedPlan.name,
      command_template: { commands: unpricedPlan.commands, output_path: unpricedPlan.output_path },
      checks: unpricedPlan.checks, created_at: new Date(0).toISOString(), arch: "arm64",
      tool: "soffice", install_weight: "heavy",
    };
    const lines: string[] = [];
    const log = spyOn(console, "log").mockImplementation((...args) => lines.push(args.join(" ")));
    try {
      printRecipeCard(recipe, unpricedPlan, [], false);
    } finally {
      log.mockRestore();
    }
    expect(lines.join("\n")).not.toContain("Replaces");
    expect(lines.join("\n")).not.toContain("/mo");
  });
});
