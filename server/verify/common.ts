import { isAbsolute, resolve } from "node:path";
import { executeFfprobe } from "../executor.ts";
import { validateMediaPath, type FfprobeQuery } from "../ffprobe-policy.ts";
import type { CheckTarget } from "../plan.ts";
import type { VerificationContext, VerificationResult } from "./types.ts";

export interface ProbeStream {
  codec_type?: unknown;
  codec_name?: unknown;
  nb_read_frames?: unknown;
  channels?: unknown;
  sample_rate?: unknown;
}

export function result(
  name: string,
  pass: boolean,
  expected: string,
  actual: string,
): VerificationResult {
  return { name, pass, expected, actual };
}

export async function probeJson(
  query: FfprobeQuery,
  path: string,
  context: VerificationContext,
): Promise<unknown> {
  const probe = await executeFfprobe(query, path, context.profile, {
    ...context.executionOptions,
    onEvent: context.onExecutionEvent,
  });
  if (!probe.ok || probe.stderr_tail.trim()) {
    throw new Error(`ffprobe exit ${probe.exit_code}: ${probe.stderr_tail.trim() || "no details"}`);
  }
  try {
    return JSON.parse(probe.stdout_tail);
  } catch {
    throw new Error("ffprobe returned invalid JSON");
  }
}

export function streamsFrom(value: unknown): ProbeStream[] {
  if (typeof value !== "object" || value === null || !("streams" in value)) return [];
  const streams = (value as { streams?: unknown }).streams;
  return Array.isArray(streams)
    ? streams.filter((item): item is ProbeStream => typeof item === "object" && item !== null)
    : [];
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

export function grantedSource(target: string, context: VerificationContext): string | null {
  if (target.includes("\0") || !isAbsolute(target)) return null;
  const normalized = resolve(target);
  const granted = context.sourcePaths.find((path) =>
    typeof path === "string" && isAbsolute(path) && resolve(path) === normalized
  );
  return granted ? validateMediaPath(granted) : null;
}

export async function verifyDurationMatches(
  target: CheckTarget,
  context: VerificationContext,
): Promise<VerificationResult> {
  if (typeof target !== "string") {
    return result("duration_matches", false, "granted source duration ±0.500 s", `invalid target: ${String(target)}`);
  }
  const source = grantedSource(target, context);
  if (!source) {
    return result("duration_matches", false, "granted source duration ±0.500 s", `ungranted source: ${target}`);
  }
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
