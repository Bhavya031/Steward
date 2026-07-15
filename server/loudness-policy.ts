import { validateMediaPath } from "./ffprobe-policy.ts";

export function buildLoudnessCommand(inputPath: unknown): string[] {
  return [
    "ffmpeg", "-hide_banner", "-nostdin",
    "-i", validateMediaPath(inputPath),
    "-vn", "-af", "loudnorm=print_format=json",
    "-f", "null", "-",
  ];
}
