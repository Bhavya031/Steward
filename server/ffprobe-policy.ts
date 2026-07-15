import { constants, accessSync, realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { ExecutionError } from "./execution-types.ts";

const QUERY_ARGS = {
  duration: ["-v", "error", "-show_entries", "format=duration", "-of", "json"],
  streams: [
    "-v", "error", "-show_entries",
    "stream=index,codec_type,codec_name,channels,sample_rate", "-of", "json",
  ],
  decode: [
    "-v", "error", "-count_frames", "-show_entries",
    "stream=index,codec_type,nb_read_frames", "-of", "json",
  ],
  media_format: [
    "-v", "error", "-show_entries", "format=format_name:format_tags=major_brand", "-of", "json",
  ],
} as const;

export type FfprobeQuery = keyof typeof QUERY_ARGS;

export function validateMediaPath(value: unknown): string {
  if (typeof value !== "string" || value.includes("\0") || !isAbsolute(value)) {
    throw new ExecutionError("ffprobe input must be an absolute path without NUL bytes");
  }
  try {
    const path = realpathSync(value);
    if (!statSync(path).isFile()) throw new Error("not a file");
    accessSync(path, constants.R_OK);
    return path;
  } catch {
    throw new ExecutionError(`ffprobe input is not a readable file: ${value}`);
  }
}

export function buildFfprobeCommand(query: unknown, inputPath: unknown): string[] {
  if (typeof query !== "string" || !Object.hasOwn(QUERY_ARGS, query)) {
    throw new ExecutionError("ffprobe query is not allowlisted");
  }
  return ["ffprobe", ...QUERY_ARGS[query as FfprobeQuery], validateMediaPath(inputPath)];
}
