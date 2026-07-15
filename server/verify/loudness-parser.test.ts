import { describe, expect, test } from "bun:test";
import { parseLoudnessStats } from "./loudness-parser.ts";

const FFMPEG_8_STDERR = `
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'fixture.mp4':
size=N/A time=00:00:07.50 bitrate=N/A speed=17.2x
[Parsed_loudnorm_0 @ 0x95ac28a80]
{
  "input_i" : "-21.65",
  "input_tp" : "-17.71",
  "input_lra" : "0.00",
  "input_thresh" : "-31.65",
  "output_i" : "-23.96",
  "output_tp" : "-20.07",
  "normalization_type" : "dynamic",
  "target_offset" : "-0.05"
}
[out#0/null @ 0x95ac28300] video:0KiB audio:3000KiB
size=N/A time=00:00:08.00 bitrate=N/A speed=17.2x
`;

describe("loudnorm stderr parser", () => {
  test("extracts the measured block despite surrounding progress", () => {
    expect(parseLoudnessStats(FFMPEG_8_STDERR)).toEqual({
      inputI: -21.65,
      inputTp: -17.71,
      inputLra: 0,
      inputThresh: -31.65,
      targetOffset: -0.05,
    });
  });

  test("searches backward for the last loudnorm-shaped JSON block", () => {
    const raw = `${FFMPEG_8_STDERR}\n{"unrelated":true}`;
    expect(parseLoudnessStats(raw).inputI).toBe(-21.65);
  });

  test("accepts silent negative-infinity measurements", () => {
    const raw = `progress\n{"input_i":"-inf","input_tp":"-inf"}\ndone`;
    const stats = parseLoudnessStats(raw);
    expect(stats.inputI).toBe(Number.NEGATIVE_INFINITY);
    expect(stats.inputTp).toBe(Number.NEGATIVE_INFINITY);
  });

  test("fails clearly when no measurement block exists", () => {
    expect(() => parseLoudnessStats("ffmpeg exited without stats")).toThrow(
      "loudnorm JSON block was not found",
    );
  });
});
