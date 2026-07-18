import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recipeConfidence, semanticTaskSignature } from "./recipe-match.ts";
import { load, match } from "./recipes.ts";

const recipes = load();
const compress = recipes.find((recipe) => recipe.name === "compress-video-under-25mb");
const mp4 = recipes.find((recipe) => recipe.name === "convert-media-to-mp4");
const mov = recipes.find((recipe) => recipe.name === "convert-media-to-mov");
const ocr = recipes.find((recipe) => recipe.name === "ocr-scanned-pdf");
const subtitles = recipes.find((recipe) => recipe.name === "transcribe-video-to-srt");
if (!compress || !mp4 || !mov || !ocr || !subtitles) throw new Error("curated recipes are missing");
const isolated = mkdtempSync(join(tmpdir(), "steward-target-match-"));
writeFileSync(join(isolated, "convert-media-to-mp4.json"), JSON.stringify(mp4));
const exactDirectory = join(isolated, "exact");
const differentIntentDirectory = join(isolated, "different-intent");
const exactTieDirectory = join(isolated, "exact-tie");
const repeatedTask = "Create accurate SRT subtitles from this speech video";
for (const directory of [exactDirectory, differentIntentDirectory, exactTieDirectory]) {
  mkdirSync(directory);
}
writeFileSync(join(exactDirectory, `${subtitles.name}.json`), JSON.stringify({
  ...subtitles,
  task_signature: semanticTaskSignature(repeatedTask),
}));
writeFileSync(join(differentIntentDirectory, `${compress.name}.json`), JSON.stringify({
  ...compress,
  task_signature: semanticTaskSignature("Convert this video to MP4"),
}));
for (const suffix of ["one", "two"]) {
  writeFileSync(join(exactTieDirectory, `${subtitles.name}-${suffix}.json`), JSON.stringify({
    ...subtitles,
    name: `${subtitles.name}-${suffix}`,
    task_signature: semanticTaskSignature(repeatedTask),
  }));
}
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

  test("reproduces the low lexical score from the real subtitles proof", () => {
    expect(recipeConfidence(
      subtitles, repeatedTask, ["/private/tmp/staged/uuid-first.mp4"],
    )).toBe(0.323);
  });

  test("an exact normalized task matches on a different staged file", () => {
    const first = match(
      `  CREATE accurate SRT subtitles—from this speech video!  `,
      ["/private/tmp/staged/uuid-first.mp4"],
      exactDirectory,
    );
    const second = match(
      repeatedTask,
      ["/private/tmp/staged/another-uuid-second.mp4"],
      exactDirectory,
    );
    expect(first).toMatchObject({ confidence: 1, recipe: { name: subtitles.name } });
    expect(second).toMatchObject({ confidence: 1, recipe: { name: subtitles.name } });
  });

  test("an exact task signature cannot override a different intent", () => {
    expect(match(
      "Convert this video to MP4", ["/tmp/input.mov"], differentIntentDirectory,
    )).toBeNull();
  });

  test("multiple exact candidates remain an ambiguous near tie", () => {
    expect(match(repeatedTask, ["/tmp/input.mp4"], exactTieDirectory)).toBeNull();
  });

  test("existing recipes without task metadata retain lexical matching", () => {
    expect(mp4.task_signature).toBeUndefined();
    expect(match("convert this to mp4", ["/tmp/new-input.mkv"], isolated))
      .toMatchObject({ recipe: { name: mp4.name } });
  });
});
