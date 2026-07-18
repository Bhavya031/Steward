import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recipeConfidence } from "./recipe-match.ts";
import { load, match } from "./recipes.ts";

const recipes = load();
const compress = recipes.find((recipe) => recipe.name === "compress-video-under-25mb");
const mp4 = recipes.find((recipe) => recipe.name === "convert-media-to-mp4");
const mov = recipes.find((recipe) => recipe.name === "convert-media-to-mov");
const ocr = recipes.find((recipe) => recipe.name === "ocr-scanned-pdf");
if (!compress || !mp4 || !mov || !ocr) throw new Error("curated recipes are missing");
const isolated = mkdtempSync(join(tmpdir(), "steward-target-match-"));
writeFileSync(join(isolated, "convert-media-to-mp4.json"), JSON.stringify(mp4));
afterAll(() => rmSync(isolated, { recursive: true, force: true }));

const cases = [
  ["compress this video under 25MB", "/tmp/input.mp4", compress.name],
  ["convert this to mp4", "/tmp/input.mkv", mp4.name],
  ["make this smaller for Discord", "/tmp/input.mp4", compress.name],
  ["turn this mkv into a mov", "/tmp/input.mkv", mov.name],
  ["turn this scanned PDF into a searchable PDF", "/tmp/scan.pdf", ocr.name],
  ["make this PDF searchable", "/tmp/scan.pdf", ocr.name],
] as const;

describe("precision-biased recipe matching", () => {
  test.each(cases)("selects the capability for: %s", (task, file, expected) => {
    const selected = match(task, [file]);
    expect(selected?.recipe.name).toBe(expected);
    const correct = recipes.find((recipe) => recipe.name === expected)!;
    const wrongScores = recipes.filter((recipe) => recipe !== correct)
      .map((recipe) => recipeConfidence(recipe, task, [file]));
    expect(recipeConfidence(correct, task, [file])).toBeGreaterThan(Math.max(...wrongScores));
  });

  test("mixed conversion and compression intent falls through", () => {
    expect(match("convert and compress this video", ["/tmp/input.mp4"])).toBeNull();
  });

  test("a concrete MP4 recipe cannot satisfy a MOV request", () => {
    expect(match("turn this mkv into a mov", ["/tmp/input.mkv"], isolated)).toBeNull();
  });

  test("a high-overlap but intent-free near-tie falls through", () => {
    const task = "convert media with ffmpeg";
    const scores = recipes.map((recipe) => recipeConfidence(recipe, task, ["/tmp/input.mp4"]))
      .sort((left, right) => right - left);
    expect(scores[0]).toBeGreaterThanOrEqual(0.45);
    expect(scores[0]! - scores[1]!).toBeLessThan(0.15);
    expect(match(task, ["/tmp/input.mp4"])).toBeNull();
  });
});
