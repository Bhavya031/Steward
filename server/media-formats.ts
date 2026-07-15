export type MediaFormat = "avi" | "flac" | "m4a" | "mkv" | "mov" | "mp3" | "mp4" | "ogg" | "wav" | "webm";
export interface MediaProfile {
  kind: "audio" | "video";
  videoCodec?: string;
  audioCodec: string;
}

export const MEDIA_PROFILES: Record<MediaFormat, MediaProfile> = {
  avi: { kind: "video", videoCodec: "libx264", audioCodec: "pcm_s16le" },
  flac: { kind: "audio", audioCodec: "flac" },
  m4a: { kind: "audio", audioCodec: "aac" },
  mkv: { kind: "video", videoCodec: "libx264", audioCodec: "aac" },
  mov: { kind: "video", videoCodec: "libx264", audioCodec: "aac" },
  mp3: { kind: "audio", audioCodec: "libmp3lame" },
  mp4: { kind: "video", videoCodec: "libx264", audioCodec: "aac" },
  ogg: { kind: "audio", audioCodec: "libopus" },
  wav: { kind: "audio", audioCodec: "pcm_s16le" },
  webm: { kind: "video", videoCodec: "libvpx-vp9", audioCodec: "libopus" },
};
const MEDIA_PATTERN = "avi|flac|m4a|mkv|mov|mp3|mp4|ogg|wav|webm";

export function mediaFormat(value: unknown): MediaFormat | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/^\./, "");
  return Object.hasOwn(MEDIA_PROFILES, normalized) ? normalized as MediaFormat : null;
}

export function mediaTargetFromTask(task: string): MediaFormat | null {
  const normalized = task.toLowerCase().replace(/quicktime/g, "mov");
  const matches = [...normalized.matchAll(new RegExp(`\\b(${MEDIA_PATTERN})\\b`, "g"))];
  return matches.length ? mediaFormat(matches.at(-1)?.[1]) : null;
}

export function mediaTargetFromConversionPhrase(task: string): MediaFormat | null {
  const normalized = task.toLowerCase().replace(/quicktime/g, "mov");
  const match = normalized.match(new RegExp(
    `\\b(?:to|into)\\s+(?:an?\\s+)?\\.?(${MEDIA_PATTERN})\\b`, "i",
  ));
  return mediaFormat(match?.[1]);
}
