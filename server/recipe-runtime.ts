import { executeFfprobe } from "./executor.ts";
import type { SystemProfile } from "./probe.ts";
import type { Recipe } from "./recipe-types.ts";

const BITRATE_SLOT = "{{video_bitrate_kbps}}";

function durationFrom(raw: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("cannot calculate recipe bitrate: ffprobe returned invalid JSON");
  }
  const format = typeof parsed === "object" && parsed !== null && "format" in parsed
    ? (parsed as { format?: unknown }).format : null;
  const value = typeof format === "object" && format !== null && "duration" in format
    ? (format as { duration?: unknown }).duration : null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error("cannot calculate recipe bitrate: source duration is unavailable");
  }
  return seconds;
}

export async function runtimeRecipeSlots(
  recipe: Recipe,
  files: string[],
  profile: SystemProfile,
): Promise<Record<string, string>> {
  const needsBitrate = recipe.command_template.commands.flat().some((argument) =>
    argument.includes(BITRATE_SLOT)
  );
  if (!needsBitrate) return {};
  const sizeCheck = recipe.checks.find((check) => check.type === "size_under");
  if (typeof sizeCheck?.target !== "number" || !files[0]) {
    throw new Error("video bitrate recipe requires a numeric size limit and one input");
  }
  const probe = await executeFfprobe("duration", files[0], profile);
  if (!probe.ok) throw new Error(`cannot calculate recipe bitrate: ${probe.stderr_tail}`);
  const duration = durationFrom(probe.stdout_tail);
  const totalKbps = sizeCheck.target * 8 * 0.94 / duration / 1_000;
  const videoKbps = Math.floor(totalKbps - 96);
  if (videoKbps < 32) {
    throw new Error("source is too long for the recipe's 96 kbps audio within the size limit");
  }
  return { video_bitrate_kbps: `${videoKbps}k` };
}
