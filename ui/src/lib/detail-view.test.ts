import { describe, expect, test } from "bun:test";
import type { PlanCheck, PlanCheckType } from "../../../server/plan.ts";
import {
  checkAssertion, displayArgument, formatPrice, runAgainEvent, templateFragments,
} from "./detail-view.ts";

const registeredChecks = {
  size_under: { type: "size_under", target: 25_000_000 },
  duration_matches: { type: "duration_matches", target: "{{input_0}}" },
  streams_present: { type: "streams_present", target: "video,audio" },
  plays: { type: "plays", target: true },
  audio_stream_present: { type: "audio_stream_present", target: true },
  loudness_matches: { type: "loudness_matches", target: -14 },
  true_peak_under: { type: "true_peak_under", target: -1 },
  file_valid: { type: "file_valid", target: "pdf" },
  page_count_positive: { type: "page_count_positive", target: 1 },
  page_count_matches: { type: "page_count_matches", target: "{{input_0}}" },
  text_extractable: { type: "text_extractable", target: "{{input_0}}" },
  format_matches: { type: "format_matches", target: "pdf" },
  srt_valid: { type: "srt_valid", target: true },
  cue_count: { type: "cue_count", target: 1 },
  timestamps_monotonic: { type: "timestamps_monotonic", target: true },
} satisfies Record<PlanCheckType, PlanCheck>;

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

  test("describes OCR path targets and every subtitle assertion", () => {
    expect(checkAssertion(registeredChecks.text_extractable))
      .toBe("The input file has no extractable text and the output does.");
    expect(checkAssertion(registeredChecks.page_count_matches))
      .toBe("Output page count matches the input file.");
    expect(checkAssertion(registeredChecks.srt_valid))
      .toBe("Output is a structurally valid UTF-8 SRT.");
    expect(checkAssertion(registeredChecks.cue_count))
      .toBe("Output contains at least 1 subtitle cue.");
    expect(checkAssertion(registeredChecks.timestamps_monotonic))
      .toBe("Subtitle timestamps are monotonic and every cue ends after it starts.");
  });

  test("renders a non-blank assertion for every registered verification type", () => {
    for (const check of Object.values(registeredChecks)) {
      expect(checkAssertion(check).trim().length).toBeGreaterThan(0);
    }
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
