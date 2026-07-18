import type { PlanSummary } from "./attempt-types.ts";
import type { Recipe } from "./recipe-types.ts";
import type { VerificationResult } from "./verify/types.ts";

export type ClientEvent =
  | { type: "run_task"; task: string; files: string[] }
  | { type: "run_recipe"; name: string; files: string[] }
  | { type: "confirm_install"; run_id: string; confirm: true };

interface RunEvent { run_id: string }

export type ServerEvent =
  | (RunEvent & {
    type: "run_started";
    action: "task" | "recipe";
    files: string[];
  })
  | (RunEvent & { type: "activity"; message: string })
  | (RunEvent & {
    type: "install_required";
    tool: string | null;
    command: string[] | null;
    resources: Array<{
      id: string; bytes: number; sha256: string; source: string;
    }>;
  })
  | (RunEvent & {
    type: "install_progress";
    id: string;
    received: number;
    total: number;
    percent: number;
  })
  | (RunEvent & { type: "install_complete"; message: string })
  | (RunEvent & { type: "check_pending"; name: string })
  | (RunEvent & VerificationResult & { type: "check_result" })
  | (RunEvent & {
    type: "repair_attempt";
    attempt: number;
    previous_plan: PlanSummary;
    failed_checks: VerificationResult[];
    stderr_tail: string;
  })
  | (RunEvent & { type: "recipe_saved"; recipe: Recipe })
  | (RunEvent & {
    type: "recipe_matched";
    name: string;
    score: number;
    model_calls: 0;
  })
  | (RunEvent & {
    type: "run_complete";
    success: boolean;
    output_path?: string;
    model_calls?: 0;
  })
  | { type: "error"; message: string; run_id?: string };

export type EmitServerEvent = (event: ServerEvent) => void;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0") || value.length > 2_000) {
    throw new Error(`${label} must be a non-empty string up to 2,000 characters`);
  }
  return value;
}

function files(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
    throw new Error("files must contain 1 to 32 paths");
  }
  return value.map((path, index) => text(path, `files[${index}]`));
}

export function parseClientEvent(raw: string): ClientEvent {
  if (raw.length > 64 * 1_024) throw new Error("WebSocket message exceeds 64 KiB");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("WebSocket message must be valid JSON");
  }
  if (!record(value) || typeof value.type !== "string") {
    throw new Error("WebSocket message must be a typed object");
  }
  if (value.type === "run_task" && exactKeys(value, ["type", "task", "files"])) {
    return { type: "run_task", task: text(value.task, "task"), files: files(value.files) };
  }
  if (value.type === "run_recipe" && exactKeys(value, ["type", "name", "files"])) {
    return { type: "run_recipe", name: text(value.name, "name"), files: files(value.files) };
  }
  if (value.type === "confirm_install" &&
      exactKeys(value, ["type", "run_id", "confirm"]) && value.confirm === true) {
    return { type: "confirm_install", run_id: text(value.run_id, "run_id"), confirm: true };
  }
  throw new Error("unsupported WebSocket message shape");
}
