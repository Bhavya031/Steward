import type { ComposableCatalogEntry } from "./composition-catalog.ts";
import type { CompositionContract } from "./composition-contract.ts";
import type { VerificationResult } from "./verify/types.ts";
import type { CheckTarget } from "./plan.ts";

export type CompositionClientEvent =
  | { type: "get_composable_catalog" }
  | { type: "get_composition_detail"; workflow_id: string }
  | {
    type: "run_composition";
    name: string;
    workflow_ids: string[];
    staged_input_id: string;
  }
  | {
    type: "run_saved_workflow";
    workflow_id: string;
    staged_input_id: string;
  }
  | { type: "deny_install"; run_id: string };

interface CompositionRunEvent {
  run_id: string;
}

export interface CompositionDetailCheck {
  check_id: string;
  stage_index: number;
  check_index: number;
  source_id: string;
  name: string;
  target: CheckTarget;
}

export interface CompositionDetailStage {
  stage_index: number;
  source_id: string;
  source_title: string;
  tools: string[];
  resources: string[];
  command_templates: string[][];
  output_template: string;
  checks: CompositionDetailCheck[];
}

export interface CompositionDetail {
  workflow_id: string;
  title: string;
  created_at: string;
  stage_count: number;
  command_count: number;
  contract: CompositionContract;
  stages: CompositionDetailStage[];
  evidence: [];
  history: [];
}

export interface CompositionSavedSummary {
  workflow_id: string;
  created_at: string;
  stage_count: number;
  contract: CompositionContract;
}

export type CompositionServerEvent =
  | { type: "composable_catalog"; workflows: ComposableCatalogEntry[] }
  | { type: "composition_detail"; detail: CompositionDetail }
  | (CompositionRunEvent & {
    type: "composition_run_started";
    action: "create" | "recipe";
    workflow_id: string;
  })
  | (CompositionRunEvent & {
    type: "composition_selected";
    workflow_id: string;
    model_calls: 0;
  })
  | (CompositionRunEvent & {
    type: "composition_install_required";
    tools: Array<{ tools: string[]; command: string[] }>;
    resources: Array<{ id: string; bytes: number; sha256: string; source: string }>;
  })
  | (CompositionRunEvent & {
    type: "composition_install_progress";
    id: string;
    received: number;
    total: number;
    percent: number;
  })
  | (CompositionRunEvent & {
    type: "composition_install_complete";
    message: string;
  })
  | (CompositionRunEvent & { type: "composition_install_denied" })
  | (CompositionRunEvent & {
    type: "composition_stage_started";
    stage_index: number;
    source_id: string;
  })
  | (CompositionRunEvent & {
    type: "composition_command_started";
    stage_index: number;
    source_id: string;
    command_index: number;
  })
  | (CompositionRunEvent & {
    type: "composition_command_completed";
    stage_index: number;
    source_id: string;
    command_index: number;
    exit_code: number;
    duration_ms: number;
  })
  | (CompositionRunEvent & {
    type: "composition_verification_started" | "composition_verification_completed";
    stage_index: number;
    source_id: string;
    duration_ms?: number;
  })
  | (CompositionRunEvent & {
    type: "composition_check_pending";
    stage_index: number;
    source_id: string;
    name: string;
  })
  | (CompositionRunEvent & VerificationResult & {
    type: "composition_check_result";
    stage_index: number;
    source_id: string;
  })
  | (CompositionRunEvent & {
    type: "composition_cleanup";
    success: boolean;
    failed_actions?: string[];
  })
  | (CompositionRunEvent & {
    type: "composition_saved";
    workflow: CompositionSavedSummary;
  })
  | (CompositionRunEvent & {
    type: "composition_run_complete";
    success: boolean;
    output_name?: string;
    model_calls: 0;
  })
  | (CompositionRunEvent & { type: "composition_error"; message: string });
