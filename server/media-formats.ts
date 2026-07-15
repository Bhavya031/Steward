export const MEDIA_FORMATS = [
  "avi", "flac", "m4a", "mkv", "mov", "mp3", "mp4", "ogg", "wav", "webm",
] as const;
export type MediaFormat = (typeof MEDIA_FORMATS)[number];
const MEDIA_SET = new Set<string>(MEDIA_FORMATS);
const MEDIA_PATTERN = MEDIA_FORMATS.join("|");

export function mediaFormat(value: unknown): MediaFormat | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/^\./, "");
  return MEDIA_SET.has(normalized) ? normalized as MediaFormat : null;
}

export function mediaTargetFromConversionPhrase(task: string): MediaFormat | null {
  const normalized = task.toLowerCase().replace(/quicktime/g, "mov");
  const match = normalized.match(new RegExp(
    `\\b(?:to|into)\\s+(?:an?\\s+)?\\.?(${MEDIA_PATTERN})\\b`, "i",
  ));
  return mediaFormat(match?.[1]);
}
