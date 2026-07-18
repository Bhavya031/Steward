import {
  elapsedMs, executeElapsedMs, type RunProgress, type RunStepName,
} from "./run-progress.ts";

export const STEP_ART: Record<RunStepName, string> = {
  plan: "/art/06-orange-key-tile-transparent.png",
  probe: "/art/07-blue-shears-tile-transparent.png",
  execute: "/art/hammer.png",
  verify: "/art/verify.png",
};

export const STEP_TITLES: Record<RunStepName, string> = {
  plan: "Planning locally",
  probe: "Probing this Mac",
  execute: "Executing locally",
  verify: "Verifying output",
};

export const TOOL_MARKS: Record<string, string> = {
  ffmpeg: "FF", ffprobe: "FP", pandoc: "PD", magick: "IM",
  ocrmypdf: "OCR", "whisper-cli": "WH", gs: "GS", soffice: "LO", brew: "BR",
};

export interface CheckEvidence {
  name: string;
  status: "pending" | "passed" | "failed";
  expected?: string;
  actual?: string;
}

export function activeTool(progress: RunProgress): string {
  return progress.command.trim().split(/\s+/)[0]?.split("/").at(-1) ?? "";
}

export function toolMark(tool: string): string {
  return TOOL_MARKS[tool] ?? tool.slice(0, 2).toUpperCase();
}

export function stepDuration(
  progress: RunProgress, name: RunStepName, now: number,
): string {
  const step = progress.steps[name];
  if (step.note) return step.note;
  const value = name === "execute" && step.status === "active"
    ? executeElapsedMs(progress, now)
    : elapsedMs(step, now);
  return value === undefined ? "—" : `${(value / 1_000).toFixed(2)}s`;
}

export function totalDuration(progress: RunProgress): string {
  const total = Object.values(progress.steps)
    .reduce((sum, step) => sum + (step.durationMs ?? 0), 0);
  return `${(total / 1_000).toFixed(2)}s`;
}

export function stepLines(
  progress: RunProgress,
  name: RunStepName,
  checks: CheckEvidence[],
  matchedRecipe?: string,
): string[] {
  if (name === "execute") return progress.command ? [progress.command] : [];
  if (name === "verify") {
    return checks
      .filter((check) => check.status !== "pending")
      .map((check) =>
        `${check.name}: expected ${check.expected ?? "—"} → actual ${check.actual ?? "—"}`
      );
  }
  const detail = [...(progress.steps[name].detail ?? [])];
  if (name === "plan" && matchedRecipe) {
    detail.unshift(`Matched saved recipe "${matchedRecipe}".`);
  }
  return detail;
}
