import { openSync, closeSync, readSync, statSync } from "node:fs";
import { executeFfprobe } from "../executor.ts";
import { mediaFormat, type MediaFormat } from "../media-formats.ts";
import type { CheckTarget } from "../plan.ts";
import { result } from "./common.ts";
import type { VerificationResult, VerificationRunContext } from "./types.ts";

interface ProbeFormat { format_name?: unknown; tags?: { major_brand?: unknown } }

function ebmlType(path: string): MediaFormat | null {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(Math.min(4_096, statSync(path).size));
    readSync(fd, buffer, 0, buffer.length, 0);
    for (let index = 0; index < buffer.length - 3; index += 1) {
      if (buffer[index] !== 0x42 || buffer[index + 1] !== 0x82) continue;
      const marker = buffer[index + 2]!;
      let width = 1;
      while (width <= 8 && (marker & (1 << (8 - width))) === 0) width += 1;
      if (width > 4 || index + 2 + width >= buffer.length) return null;
      let length = marker & ((1 << (8 - width)) - 1);
      for (let offset = 1; offset < width; offset += 1) length = length * 256 + buffer[index + 2 + offset]!;
      const value = buffer.subarray(index + 2 + width, index + 2 + width + length).toString("ascii");
      return value === "webm" ? "webm" : value === "matroska" ? "mkv" : null;
    }
    return null;
  } finally {
    closeSync(fd);
  }
}

function detected(format: ProbeFormat, path: string): { format: MediaFormat | null; detail: string } {
  const names = typeof format.format_name === "string" ? format.format_name.split(",") : [];
  const brand = typeof format.tags?.major_brand === "string" ? format.tags.major_brand.trim() : "";
  const ebml = names.includes("matroska") || names.includes("webm") ? ebmlType(path) : null;
  if (ebml) return { format: ebml, detail: `EBML DocType=${ebml}; ffprobe=${names.join(",")}` };
  if (names.includes("mov") || names.includes("mp4") || names.includes("m4a")) {
    const value = brand.toLowerCase() === "qt" ? "mov" : /^m4a/i.test(brand) ? "m4a" : "mp4";
    return { format: value, detail: `ffprobe=${names.join(",")}; major_brand=${brand || "unknown"}` };
  }
  const unique = (["avi", "flac", "mp3", "ogg", "wav"] as MediaFormat[]).find((name) => names.includes(name)) ?? null;
  return { format: unique, detail: `ffprobe=${names.join(",") || "unknown"}` };
}

export async function verifyMediaFormat(
  target: CheckTarget,
  context: VerificationRunContext,
): Promise<VerificationResult> {
  const expected = mediaFormat(target);
  if (!expected) return result("format_matches", false, "supported media format", `invalid target: ${String(target)}`);
  const execution = await executeFfprobe("media_format", context.outputPath, context.profile, {
    ...context.executionOptions,
    onEvent: context.onExecutionEvent,
  });
  if (!execution.ok) return result("format_matches", false, expected.toUpperCase(), `ffprobe exit ${execution.exit_code}: ${execution.stderr_tail.trim()}`);
  let parsed: unknown;
  try { parsed = JSON.parse(execution.stdout_tail); } catch { parsed = null; }
  const format = typeof parsed === "object" && parsed !== null && "format" in parsed
    ? (parsed as { format?: ProbeFormat }).format ?? {} : {};
  const actual = detected(format, context.outputPath);
  return result("format_matches", actual.format === expected, expected.toUpperCase(),
    `${actual.format?.toUpperCase() ?? "unknown"} container (${actual.detail})`);
}
