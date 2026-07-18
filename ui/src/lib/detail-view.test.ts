import { describe, expect, test } from "bun:test";
import {
  checkAssertion, displayArgument, formatPrice, runAgainEvent, templateFragments,
} from "./detail-view.ts";

describe("saved-command detail formatting", () => {
  test("highlights only real template slots", () => {
    expect(templateFragments("{{input_0_dir}}/{{input_0_stem}}-done.mp4")).toEqual([
      { text: "{{input_0_dir}}", slot: true },
      { text: "/", slot: false },
      { text: "{{input_0_stem}}", slot: true },
      { text: "-done.mp4", slot: false },
    ]);
  });

  test("preserves argv values while making spaced arguments unambiguous", () => {
    expect(displayArgument("ffmpeg")).toBe("ffmpeg");
    expect(displayArgument("a file.mov")).toBe("'a file.mov'");
    expect(displayArgument("owner's.mov")).toBe("'owner'\\''s.mov'");
  });

  test("describes registered checks from their stored targets", () => {
    expect(checkAssertion({ type: "size_under", target: 25_000_000 }))
      .toBe("Output is smaller than 25000000 bytes.");
    expect(checkAssertion({ type: "duration_matches", target: "{{input_0}}" }))
      .toBe("Output duration matches the input file.");
    expect(checkAssertion({ type: "loudness_matches", target: -14 }))
      .toBe("Integrated loudness is within ±1.0 LUFS of -14 LUFS.");
  });

  test("does not round verified replacement prices", () => {
    expect(formatPrice(9)).toBe("9");
    expect(formatPrice(6.99)).toBe("6.99");
  });

  test("RUN AGAIN uses the existing saved-command engine event and latest real files", () => {
    expect(runAgainEvent("compress-video", [
      {
        runId: "first", recipeName: "compress-video", action: "task",
        files: ["/tmp/source-a.mov"], startedAt: 1, completedAt: 2,
        success: true, checks: [],
      },
      {
        runId: "second", recipeName: "compress-video", action: "recipe",
        files: ["/tmp/source-b.mov"], startedAt: 3, completedAt: 4,
        success: true, modelCalls: 0, checks: [],
      },
    ])).toEqual({
      type: "run_recipe", name: "compress-video", files: ["/tmp/source-b.mov"],
    });
  });
});
