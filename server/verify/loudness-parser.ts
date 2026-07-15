export interface LoudnessStats {
  inputI: number;
  inputTp: number;
  inputLra?: number;
  inputThresh?: number;
  targetOffset?: number;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function level(value: unknown, name: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "-inf" || normalized === "-infinity") return Number.NEGATIVE_INFINITY;
    if (normalized === "inf" || normalized === "+inf" || normalized === "infinity") {
      return Number.POSITIVE_INFINITY;
    }
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error(`loudnorm ${name} is missing or invalid`);
}

function statsFrom(value: unknown): LoudnessStats | null {
  if (!record(value) || !("input_i" in value) || !("input_tp" in value)) return null;
  const stats: LoudnessStats = {
    inputI: level(value.input_i, "input_i"),
    inputTp: level(value.input_tp, "input_tp"),
  };
  if ("input_lra" in value) stats.inputLra = level(value.input_lra, "input_lra");
  if ("input_thresh" in value) stats.inputThresh = level(value.input_thresh, "input_thresh");
  if ("target_offset" in value) stats.targetOffset = level(value.target_offset, "target_offset");
  return stats;
}

export function parseLoudnessStats(stderr: string): LoudnessStats {
  const blocks = stderr.match(/\{[^{}]*\}/gs) ?? [];
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    try {
      const stats = statsFrom(JSON.parse(blocks[index]!));
      if (stats) return stats;
    } catch {
      // Earlier stderr can contain non-JSON braces; keep searching backwards.
    }
  }
  throw new Error("ffmpeg loudnorm JSON block was not found");
}
