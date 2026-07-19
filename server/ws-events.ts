import type { PlanSummary } from "./attempt-types.ts";
import type { Recipe } from "./recipe-types.ts";
import type { VerificationResult } from "./verify/types.ts";
import type {
  CompositionClientEvent, CompositionServerEvent,
} from "./ws-composition-events.ts";
import {
  exactKeys, files, record, stagedInputId, text, workflowId, workflowIds,
} from "./ws-protocol-validation.ts";

export type ClientEvent =
  | { type: "run_task"; task: string; files: string[] }
  | { type: "run_saved_workflow"; workflow_id: string; files: string[] }
  | { type: "confirm_install"; run_id: string; confirm: true };
export type WsClientEvent = ClientEvent | CompositionClientEvent;

interface RunEvent { run_id: string }

export type ServerEvent =
  | { type: "workflow_catalog"; workflows: Recipe[] }
  | (RunEvent & {
    type: "run_started";
    action: "task" | "recipe";
    files: string[];
  })
  | (RunEvent & { type: "activity"; message: string })
  | (RunEvent & { type: "model_call_count"; model_calls: number })
  | (RunEvent & { type: "command_started"; argv: string[] })
  | (RunEvent & {
    type: "command_completed";
    exit_code: number;
    duration_ms: number;
  })
  | (RunEvent & { type: "verification_started" })
  | (RunEvent & { type: "verification_completed"; duration_ms: number })
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
    type: "workflow_selected";
    workflow_id: string;
    model_calls: 0;
  })
  | (RunEvent & {
    type: "run_complete";
    success: boolean;
    output_path?: string;
    model_calls?: number;
  })
  | { type: "error"; message: string; run_id?: string };

export type EmitServerEvent = (event: ServerEvent) => void;
export type WsServerEvent = ServerEvent | CompositionServerEvent;
export type EmitWsEvent = (event: WsServerEvent) => void;

export function parseClientEvent(raw: string): WsClientEvent {
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
  if (value.type === "run_saved_workflow" &&
      exactKeys(value, ["type", "workflow_id", "files"])) {
    return {
      type: "run_saved_workflow",
      workflow_id: workflowId(value.workflow_id),
      files: files(value.files),
    };
  }
  if (value.type === "get_composable_catalog" && exactKeys(value, ["type"])) {
    return { type: "get_composable_catalog" };
  }
  if (value.type === "run_composition" && exactKeys(
    value, ["type", "name", "workflow_ids", "staged_input_id"],
  )) {
    return {
      type: "run_composition",
      name: workflowId(value.name, "name"),
      workflow_ids: workflowIds(value.workflow_ids),
      staged_input_id: stagedInputId(value.staged_input_id),
    };
  }
  if (value.type === "run_saved_workflow" && exactKeys(
    value, ["type", "workflow_id", "staged_input_id"],
  )) {
    return {
      type: "run_saved_workflow",
      workflow_id: workflowId(value.workflow_id),
      staged_input_id: stagedInputId(value.staged_input_id),
    };
  }
  if (value.type === "deny_install" && exactKeys(value, ["type", "run_id"])) {
    return { type: "deny_install", run_id: text(value.run_id, "run_id") };
  }
  if (value.type === "confirm_install" &&
      exactKeys(value, ["type", "run_id", "confirm"]) && value.confirm === true) {
    return { type: "confirm_install", run_id: text(value.run_id, "run_id"), confirm: true };
  }
  throw new Error("unsupported WebSocket message shape");
}
