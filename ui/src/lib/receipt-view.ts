import type { RunProgress, RunStepName } from "./run-progress.ts";

export const PLANNER_LABEL = "gpt-5.6";

export function formatClock(ms: number | undefined): string {
  if (ms === undefined) return "--:--";
  const seconds = Math.max(1, Math.ceil(ms / 1_000));
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function stepTool(
  progress: RunProgress, name: RunStepName, matchedRecipe?: string,
): string {
  if (name === "plan") return matchedRecipe ? "shelf" : PLANNER_LABEL;
  if (name === "execute") {
    return progress.commands[0]?.trim().split(/\s+/)[0]?.split("/").at(-1) ?? "local";
  }
  return "ffprobe";
}

export interface PipelineSegment {
  kind: "bash" | "ffmpeg";
  label: string;
}

export function pipelineSegments(progress: RunProgress): PipelineSegment[] {
  const segments: PipelineSegment[] = [{ kind: "bash", label: "ffprobe" }];
  const seen = new Map<string, number>();
  const passTools = new Set(
    progress.commands
      .filter((command) => /-pass\s+\d+/.test(command))
      .map((command) => command.trim().split(/\s+/)[0]?.split("/").at(-1)),
  );
  for (const command of progress.commands) {
    const tool = command.trim().split(/\s+/)[0]?.split("/").at(-1) ?? "sh";
    const count = (seen.get(tool) ?? 0) + 1;
    seen.set(tool, count);
    const pass = command.match(/-pass\s+(\d+)/)?.[1]
      ?? (passTools.has(tool) ? String(count) : undefined);
    const label = pass
      ? `${tool} pass ${pass}`
      : count > 1 ? `${tool} ${count}` : tool;
    segments.push({ kind: tool === "ffmpeg" ? "ffmpeg" : "bash", label });
  }
  return segments;
}

export function scriptText(progress: RunProgress, recipeName?: string): string {
  return [
    "#!/bin/sh",
    `# ${recipeName ?? "steward-recipe"} — verified locally by Steward`,
    "set -e",
    ...progress.commands,
    "",
  ].join("\n");
}

export function raycastDeeplink(progress: RunProgress, recipeName?: string): string {
  const payload = {
    name: recipeName ?? "steward-recipe",
    text: progress.commands.join(" && "),
  };
  return `raycast://snippets/import?snippet=${
    encodeURIComponent(JSON.stringify(payload))
  }`;
}
