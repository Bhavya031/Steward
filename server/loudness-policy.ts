import { validateMediaPath } from "./ffprobe-policy.ts";

function level(value: unknown, minimum: number, maximum: number, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

export function buildLoudnessCommand(inputPath: unknown): string[] {
  return [
    "ffmpeg", "-hide_banner", "-nostdin",
    "-i", validateMediaPath(inputPath),
    "-vn", "-af", "loudnorm=print_format=json",
    "-f", "null", "-",
  ];
}

export function buildLoudnessMeasurementCommand(
  inputPath: unknown, targetLufs: unknown, maxDbtp: unknown,
): string[] {
  const integrated = level(targetLufs, -70, -5, "loudness target");
  const peak = level(maxDbtp, -9, 0, "true-peak target");
  return [
    "ffmpeg", "-hide_banner", "-nostdin",
    "-i", validateMediaPath(inputPath), "-vn", "-af",
    `loudnorm=I=${integrated}:TP=${peak}:LRA=11:print_format=json`,
    "-f", "null", "-",
  ];
}
