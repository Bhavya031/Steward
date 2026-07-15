import { statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { executeFfprobe } from "../executor.ts";
import { validateMediaPath, type FfprobeQuery } from "../ffprobe-policy.ts";
import type { CheckTarget } from "../plan.ts";
import type { VerificationContext, VerificationResult } from "./types.ts";

export const VIDEO_CHECK_TYPES = [
  "size_under", "duration_matches", "streams_present", "plays",
] as const;
export type VideoCheckType = (typeof VIDEO_CHECK_TYPES)[number];

interface ProbeStream {
  codec_type?: unknown;
  codec_name?: unknown;
  nb_read_frames?: unknown;
}

function result(name: string, pass: boolean, expected: string, actual: string): VerificationResult {
  return { name, pass, expected, actual };
}

function formatBytes(bytes: number): string {
  const units = ["bytes", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1_024 && unit < units.length - 1) {
    value /= 1_024;
    unit += 1;
  }
  const display = unit === 0 ? String(bytes) : value.toFixed(2);
  return `${display} ${units[unit]} (${bytes.toLocaleString("en-US")} bytes)`;
}

async function probeJson(query: FfprobeQuery, path: string, context: VerificationContext): Promise<unknown> {
  const probe = await executeFfprobe(query, path, context.profile);
  if (!probe.ok || probe.stderr_tail.trim()) {
    throw new Error(`ffprobe exit ${probe.exit_code}: ${probe.stderr_tail.trim() || "no details"}`);
  }
  try {
    return JSON.parse(probe.stdout_tail);
  } catch {
    throw new Error("ffprobe returned invalid JSON");
  }
}

function streamsFrom(value: unknown): ProbeStream[] {
  if (typeof value !== "object" || value === null || !("streams" in value)) return [];
  const streams = (value as { streams?: unknown }).streams;
  return Array.isArray(streams) ? streams.filter((item): item is ProbeStream => typeof item === "object" && item !== null) : [];
}

function durationFrom(value: unknown): number {
  const format = typeof value === "object" && value !== null && "format" in value
    ? (value as { format?: unknown }).format : null;
  const raw = typeof format === "object" && format !== null && "duration" in format
    ? (format as { duration?: unknown }).duration : null;
  const duration = typeof raw === "string" || typeof raw === "number" ? Number(raw) : NaN;
  if (!Number.isFinite(duration) || duration < 0) throw new Error("ffprobe returned no duration");
  return duration;
}

async function sizeUnder(target: CheckTarget, context: VerificationContext): Promise<VerificationResult> {
  if (typeof target !== "number" || !Number.isFinite(target) || target <= 0) {
    return result("size_under", false, "positive byte limit", `invalid target: ${String(target)}`);
  }
  const bytes = statSync(validateMediaPath(context.outputPath)).size;
  return result("size_under", bytes < target, `under ${formatBytes(target)}`, formatBytes(bytes));
}

function grantedSource(target: string, context: VerificationContext): string | null {
  if (target.includes("\0") || !isAbsolute(target)) return null;
  const normalized = resolve(target);
  const granted = context.sourcePaths.find((path) =>
    typeof path === "string" && isAbsolute(path) && resolve(path) === normalized
  );
  return granted ? validateMediaPath(granted) : null;
}

async function durationMatches(target: CheckTarget, context: VerificationContext): Promise<VerificationResult> {
  if (typeof target !== "string") {
    return result("duration_matches", false, "granted source duration ±0.500 s", `invalid target: ${String(target)}`);
  }
  const source = grantedSource(target, context);
  if (!source) return result("duration_matches", false, "granted source duration ±0.500 s", `ungranted source: ${target}`);
  const [expected, actual] = await Promise.all([
    probeJson("duration", source, context).then(durationFrom),
    probeJson("duration", context.outputPath, context).then(durationFrom),
  ]);
  const difference = Math.abs(actual - expected);
  return result(
    "duration_matches", difference <= 0.5,
    `${expected.toFixed(3)} s ±0.500 s`,
    `${actual.toFixed(3)} s (Δ ${difference.toFixed(3)} s)`,
  );
}

async function streamsPresent(target: CheckTarget, context: VerificationContext): Promise<VerificationResult> {
  const required = typeof target === "string" ? target.split(",").map((item) => item.trim()).filter(Boolean) : [];
  const validTypes = new Set(["video", "audio", "subtitle", "data", "attachment"]);
  if (!required.length || required.some((type) => !validTypes.has(type))) {
    return result("streams_present", false, "comma-separated stream types", `invalid target: ${String(target)}`);
  }
  const streams = streamsFrom(await probeJson("streams", context.outputPath, context));
  const present = new Set(streams.map((stream) => stream.codec_type).filter((type): type is string => typeof type === "string"));
  const actual = streams.length
    ? streams.map((stream) => `${String(stream.codec_type)} (${String(stream.codec_name)})`).join(", ")
    : "no streams detected";
  return result("streams_present", required.every((type) => present.has(type)), required.join(", "), actual);
}

async function plays(target: CheckTarget, context: VerificationContext): Promise<VerificationResult> {
  if (target !== true) return result("plays", false, "target true", `invalid target: ${String(target)}`);
  const probe = await executeFfprobe("decode", context.outputPath, context.profile);
  let streams: ProbeStream[] = [];
  try {
    streams = streamsFrom(JSON.parse(probe.stdout_tail));
  } catch {
    // Invalid JSON is recorded below as no decoded frames.
  }
  const counts = streams.map((stream) => Number(stream.nb_read_frames));
  const scan = streams.length
    ? streams.map((stream) => `${String(stream.codec_type)}=${String(stream.nb_read_frames)} frames`).join(", ")
    : "no decoded frames";
  const errors = probe.stderr_tail.trim();
  const pass = probe.ok && !errors && counts.some((count) => Number.isFinite(count) && count > 0);
  const detail = errors || (probe.ok ? "no decode errors" : "no stderr details");
  const actual = `${scan}; ffprobe exit ${probe.exit_code}; ${detail}`;
  return result("plays", pass, "full frame scan with no decode errors", actual);
}

export async function verifyVideoCheck(
  type: VideoCheckType,
  target: CheckTarget,
  context: VerificationContext,
): Promise<VerificationResult> {
  if (type === "size_under") return sizeUnder(target, context);
  if (type === "duration_matches") return durationMatches(target, context);
  if (type === "streams_present") return streamsPresent(target, context);
  return plays(target, context);
}
