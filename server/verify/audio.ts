import { resolve } from "node:path";
import { executeLoudnessScan } from "../executor.ts";
import type { CheckTarget } from "../plan.ts";
import { probeJson, result, streamsFrom, verifyDurationMatches } from "./common.ts";
import { parseLoudnessStats, type LoudnessStats } from "./loudness-parser.ts";
import type { VerificationResult, VerificationRunContext } from "./types.ts";

export const AUDIO_CHECK_TYPES = [
  "audio_stream_present", "loudness_matches", "true_peak_under", "duration_matches",
] as const;
export type AudioCheckType = (typeof AUDIO_CHECK_TYPES)[number];
const SILENCE_LUFS = -69;

function displayLevel(value: number): string {
  return value === Number.NEGATIVE_INFINITY ? "-inf" : value.toFixed(1);
}

export async function measureLoudness(
  file: string,
  context: VerificationRunContext,
): Promise<LoudnessStats> {
  const key = `loudness:${resolve(file)}`;
  const cached = context.measurements.get(key) as Promise<LoudnessStats> | undefined;
  if (cached) return cached;
  const measurement = (async () => {
    const execution = await executeLoudnessScan(file, context.profile, context.onExecutionEvent
      ? { onEvent: context.onExecutionEvent }
      : {});
    if (!execution.ok) {
      throw new Error(`ffmpeg loudness scan exited ${execution.exit_code}: ${execution.stderr_tail}`);
    }
    return parseLoudnessStats(execution.stderr_tail);
  })();
  context.measurements.set(key, measurement);
  return measurement;
}

async function audioStreamPresent(
  target: CheckTarget,
  context: VerificationRunContext,
): Promise<VerificationResult> {
  if (target !== true) {
    return result("audio_stream_present", false, "at least one audio stream", `invalid target: ${String(target)}`);
  }
  const streams = streamsFrom(await probeJson("streams", context.outputPath, context))
    .filter((stream) => stream.codec_type === "audio");
  const actual = streams.length
    ? streams.map((stream) => {
      const codec = typeof stream.codec_name === "string" ? stream.codec_name : "unknown codec";
      const channels = Number(stream.channels);
      const channelText = Number.isFinite(channels) && channels > 0 ? `${channels}ch` : "unknown channels";
      const rate = Number(stream.sample_rate);
      const rateText = Number.isFinite(rate) && rate > 0 ? `${rate}Hz` : "unknown sample rate";
      return `${codec}, ${channelText}, ${rateText}`;
    }).join("; ")
    : "no audio streams detected";
  return result("audio_stream_present", streams.length > 0, "at least one audio stream", actual);
}

async function loudnessMatches(
  target: CheckTarget,
  context: VerificationRunContext,
): Promise<VerificationResult> {
  if (typeof target !== "number" || !Number.isFinite(target)) {
    return result("loudness_matches", false, "finite LUFS target ±1.0", `invalid target: ${String(target)}`);
  }
  const { inputI } = await measureLoudness(context.outputPath, context);
  const expected = `target ${target.toFixed(1)} LUFS ±1.0`;
  if (!Number.isFinite(inputI) || inputI <= SILENCE_LUFS) {
    return result(
      "loudness_matches", false, expected,
      `silent/near-silent audio; measured ${displayLevel(inputI)} LUFS`,
    );
  }
  const difference = Math.abs(inputI - target);
  return result(
    "loudness_matches", difference <= 1,
    expected, `measured ${inputI.toFixed(1)} LUFS (Δ ${difference.toFixed(1)} LUFS)`,
  );
}

async function truePeakUnder(
  target: CheckTarget,
  context: VerificationRunContext,
): Promise<VerificationResult> {
  if (typeof target !== "number" || !Number.isFinite(target)) {
    return result("true_peak_under", false, "finite dBTP maximum", `invalid target: ${String(target)}`);
  }
  const { inputTp } = await measureLoudness(context.outputPath, context);
  return result(
    "true_peak_under", inputTp <= target,
    `at or below ${target.toFixed(1)} dBTP`, `measured ${displayLevel(inputTp)} dBTP`,
  );
}

export async function verifyAudioCheck(
  type: AudioCheckType,
  target: CheckTarget,
  context: VerificationRunContext,
): Promise<VerificationResult> {
  if (type === "audio_stream_present") return audioStreamPresent(target, context);
  if (type === "loudness_matches") return loudnessMatches(target, context);
  if (type === "true_peak_under") return truePeakUnder(target, context);
  return verifyDurationMatches(target, context);
}
