import type { Plan } from "./plan.ts";
import type { PlanExecutionResult } from "./execution-types.ts";
import type { VerificationResult } from "./verify/index.ts";

export interface PlanSummary {
  tool: Plan["tool"];
  command_count: number;
  output_path: string;
  checks: string[];
}

export interface AttemptOutcome {
  status: "passed" | "execution_failed" | "verification_failed";
  exit_code: number;
  commands_completed: number;
  checks_passed: number;
  checks_total: number;
  failed_checks: VerificationResult[];
  stderr_tail: string;
}

export interface AttemptEvent {
  type: "attempt";
  attempt: number;
  plan_summary: PlanSummary;
  outcome: AttemptOutcome;
}

export interface AttemptRun {
  plan: Plan;
  execution: PlanExecutionResult;
  checks: VerificationResult[];
  all_pass: boolean;
  events: AttemptEvent[];
}
