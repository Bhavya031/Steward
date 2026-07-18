import { readFileSync } from "node:fs";
import type { CheckTarget } from "../plan.ts";
import { result } from "./common.ts";
import type { VerificationResult, VerificationRunContext } from "./types.ts";

export const SRT_CHECK_TYPES = [
  "srt_valid", "cue_count", "timestamps_monotonic",
] as const;
export type SrtCheckType = (typeof SRT_CHECK_TYPES)[number];

interface Cue { index: number; start: number; end: number; text: string }
interface Inspection { valid: boolean; cues: Cue[]; monotonic: boolean; error?: string }

function milliseconds(value: string): number | null {
  const match = value.match(/^(\d{2}):([0-5]\d):([0-5]\d),(\d{3})$/);
  if (!match) return null;
  return Number(match[1]) * 3_600_000 + Number(match[2]) * 60_000 +
    Number(match[3]) * 1_000 + Number(match[4]);
}

export function inspectSrt(path: string): Inspection {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
  } catch (error) {
    return { valid: false, cues: [], monotonic: false, error: `unreadable UTF-8: ${String(error)}` };
  }
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return { valid: false, cues: [], monotonic: false, error: "empty subtitle file" };
  const cues: Cue[] = [];
  for (const [position, block] of normalized.split(/\n{2,}/).entries()) {
    const lines = block.split("\n");
    if (!/^\d+$/.test(lines[0] ?? "")) {
      return { valid: false, cues, monotonic: false, error: `cue ${position + 1} has no numeric index` };
    }
    const times = (lines[1] ?? "").match(
      /^(\d{2}:[0-5]\d:[0-5]\d,\d{3}) --> (\d{2}:[0-5]\d:[0-5]\d,\d{3})(?: .*)?$/,
    );
    const start = times ? milliseconds(times[1]!) : null;
    const end = times ? milliseconds(times[2]!) : null;
    const body = lines.slice(2).join("\n").trim();
    if (start === null || end === null || end <= start || !body) {
      return { valid: false, cues, monotonic: false, error: `cue ${position + 1} is malformed` };
    }
    cues.push({ index: Number(lines[0]), start, end, text: body });
  }
  const indexes = cues.every((cue, index) => cue.index === index + 1);
  const monotonic = cues.every((cue, index) =>
    index === 0 ||
    (cue.start >= cues[index - 1]!.start && cue.end >= cues[index - 1]!.end)
  );
  if (!indexes) return { valid: false, cues, monotonic, error: "cue indexes are not sequential" };
  return { valid: true, cues, monotonic };
}

export async function verifySrtCheck(
  type: SrtCheckType,
  target: CheckTarget,
  context: VerificationRunContext,
): Promise<VerificationResult> {
  const evidence = inspectSrt(context.outputPath);
  if (type === "srt_valid") {
    return result(
      type, target === true && evidence.valid,
      "valid UTF-8 SRT with sequential non-empty cues",
      evidence.valid ? `${evidence.cues.length} structurally valid cues` : evidence.error ?? "invalid SRT",
    );
  }
  if (type === "cue_count") {
    const minimum = typeof target === "number" && Number.isInteger(target) ? target : 1;
    return result(
      type, evidence.valid && evidence.cues.length >= minimum,
      `at least ${minimum} cue${minimum === 1 ? "" : "s"}`,
      evidence.valid ? `${evidence.cues.length} cues` : evidence.error ?? "invalid SRT",
    );
  }
  return result(
    type, target === true && evidence.valid && evidence.monotonic,
    "cue timestamps are nondecreasing and every end follows its start",
    evidence.valid
      ? `${evidence.cues.length} cues; timestamps ${evidence.monotonic ? "monotonic" : "out of order"}`
      : evidence.error ?? "invalid SRT",
  );
}
