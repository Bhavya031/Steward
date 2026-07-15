import { executeFfprobe } from "./executor.ts";
import { MEDIA_PROFILES, mediaTargetFromTask } from "./media-formats.ts";
import type { SystemProfile } from "./probe.ts";
import type { Recipe } from "./recipe-types.ts";
import type { RecipeSlotValue } from "./recipe-template.ts";

function streamTypes(raw: string): Set<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("cannot specialize media recipe: ffprobe returned invalid JSON");
  }
  const streams = typeof parsed === "object" && parsed !== null && "streams" in parsed
    ? (parsed as { streams?: unknown }).streams : null;
  if (!Array.isArray(streams)) return new Set();
  return new Set(streams.flatMap((stream) =>
    typeof stream === "object" && stream !== null && "codec_type" in stream &&
    typeof (stream as { codec_type?: unknown }).codec_type === "string"
      ? [(stream as { codec_type: string }).codec_type] : []
  ));
}

export async function mediaRecipeSlots(
  recipe: Recipe,
  files: string[],
  profile: SystemProfile,
  task: string | undefined,
): Promise<Record<string, RecipeSlotValue>> {
  const usesMediaSlots = JSON.stringify(recipe.command_template).includes("{{media_args}}") ||
    JSON.stringify(recipe.checks).includes("{{target_format}}");
  if (!usesMediaSlots) return {};
  const format = task ? mediaTargetFromTask(task) : null;
  if (!format) throw new Error("media conversion recipe requires a supported target format in the task");
  if (!files[0]) throw new Error("media conversion recipe requires one input file");
  const probe = await executeFfprobe("streams", files[0], profile);
  if (!probe.ok) throw new Error(`cannot specialize media recipe: ${probe.stderr_tail}`);
  const streams = streamTypes(probe.stdout_tail);
  const media = MEDIA_PROFILES[format];
  if (media.kind === "audio" && !streams.has("audio")) {
    throw new Error(`cannot convert to ${format}: input has no audio stream`);
  }
  const args: string[] = [];
  const outputStreams: string[] = [];
  if (media.kind === "audio") args.push("-vn");
  if (media.kind === "video" && streams.has("video") && media.videoCodec) {
    args.push("-c:v", media.videoCodec);
    outputStreams.push("video");
  }
  if (streams.has("audio")) {
    args.push("-c:a", media.audioCodec);
    outputStreams.push("audio");
  }
  if (outputStreams.length === 0) throw new Error("input has no convertible media streams");
  return { target_format: format, target_streams: outputStreams.join(","), media_args: args };
}
