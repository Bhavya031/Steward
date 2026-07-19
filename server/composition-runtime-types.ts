import type { ExecutionEvent, ExecutionOptions, PlanExecutionResult } from "./executor.ts";
import type { Plan } from "./plan.ts";
import type { SystemProfile } from "./probe.ts";
import type { VerificationResult } from "./verify/index.ts";

export interface StageVerificationResult extends VerificationResult {
  stage_index: number;
  source_id: string;
}

export interface CompositionStageRun {
  stage_index: number;
  source_id: string;
  input_path: string;
  plan: Plan;
  execution: PlanExecutionResult;
  checks: StageVerificationResult[];
  all_pass: boolean;
}

export interface CompositionRun {
  composition_id: string;
  success: boolean;
  output_path?: string;
  failed_stage?: number;
  stages: CompositionStageRun[];
  model_calls: 0;
}

export type CompositionRuntimeEvent =
  | {
    type: "stage_started";
    stage_index: number;
    source_id: string;
    check_names: string[];
  }
  | {
    type: "execution";
    stage_index: number;
    source_id: string;
    event: ExecutionEvent;
  }
  | {
    type: "verification_started";
    stage_index: number;
    source_id: string;
  }
  | {
    type: "verification_completed";
    stage_index: number;
    source_id: string;
    duration_ms: number;
  }
  | { type: "check_result"; result: StageVerificationResult };

export interface CompositionRuntimeOptions {
  profile?: SystemProfile;
  executionOptions?: ExecutionOptions;
  onEvent?: (event: CompositionRuntimeEvent) => void;
}
