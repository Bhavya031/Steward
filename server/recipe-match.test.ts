import { describe, expect, test } from "bun:test";
import { recipeConfidence } from "./recipe-match.ts";
import { load, match } from "./recipes.ts";

const recipes = load();
const compress = recipes.find((recipe) => recipe.name === "compress-video-under-25mb");
const convert = recipes.find((recipe) => recipe.name === "convert-video-audio");
if (!compress || !convert) throw new Error("curated media recipes are missing");

const cases = [
  ["compress this video under 25MB", "/tmp/input.mp4", compress.name],
  ["convert this to mp4", "/tmp/input.mkv", convert.name],
  ["make this smaller for Discord", "/tmp/input.mp4", compress.name],
  ["turn this mkv into a mov", "/tmp/input.mkv", convert.name],
] as const;

describe("precision-biased recipe matching", () => {
  test.each(cases)("selects the capability for: %s", (task, file, expected) => {
    const selected = match(task, [file]);
    expect(selected?.recipe.name).toBe(expected);
    const correct = expected === compress.name ? compress : convert;
    const wrong = expected === compress.name ? convert : compress;
    expect(recipeConfidence(correct, task, [file])).toBeGreaterThan(
      recipeConfidence(wrong, task, [file]),
    );
  });

  test("mixed conversion and compression intent falls through", () => {
    expect(match("convert and compress this video", ["/tmp/input.mp4"])).toBeNull();
  });

  test("a high-overlap but intent-free near-tie falls through", () => {
    const task = "process this video with ffmpeg";
    const scores = recipes.map((recipe) => recipeConfidence(recipe, task, ["/tmp/input.mp4"]))
      .sort((left, right) => right - left);
    expect(scores[0]).toBeGreaterThanOrEqual(0.45);
    expect(scores[0]! - scores[1]!).toBeLessThan(0.15);
    expect(match(task, ["/tmp/input.mp4"])).toBeNull();
  });
});
