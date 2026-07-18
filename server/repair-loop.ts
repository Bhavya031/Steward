import type { RepairContext } from "./agent-prompts.ts";
import type { AttemptEvent, AttemptOutcome, AttemptRun, PlanSummary } from "./attempt-types.ts";
import { discardFailedOutput } from "./failed-output.ts";
import { materializePlanDerivations } from "./derivation-runtime.ts";
import { executePlan, type ExecutionOptions, type PlanExecutionResult } from "./executor.ts";
import { allocatePlanOutput } from "./output-allocation.ts";
import type { Plan } from "./plan.ts";
import type { SystemProfile } from "./probe.ts";
import { enforceRepairIntegrity } from "./repair-integrity.ts";
import { verifyChecks, type VerificationResult } from "./verify/index.ts";

const MAX_ATTEMPTS = 3;

export interface RepairLoopOptions {
  initialPlan: Plan;
  profile: SystemProfile;
  inputPaths: string[];
  repair: (context: RepairContext) => Promise<Plan>;
  executionOptions?: ExecutionOptions;
  onVerificationStarted?: () => void;
  onVerificationCompleted?: (durationMs: number) => void;
  onAttempt?: (event: AttemptEvent) => void;
}

function lastLines(value: string, count = 30): string {
  return value.split(/\r?\n|\r/).filter(Boolean).slice(-count).join("\n");
}

function summary(plan: Plan): PlanSummary {
  return {
    tool: plan.tool,
    command_count: plan.commands.length,
    output_path: plan.output_path,
    checks: plan.checks.map((check) => check.type),
    commands: plan.commands.map((command) => [...command]),
    intermediates: [...(plan.intermediates ?? [])],
    derivations: plan.derivations ?? null,
  };
}

function skippedChecks(plan: Plan, exitCode: number): VerificationResult[] {
  return plan.checks.map((check) => ({
    name: check.type,
    pass: false,
    expected: `verification after all ${plan.commands.length} command(s) complete`,
    actual: `not run; execution stopped with exit ${exitCode}`,
  }));
}

function outcome(
  executionOk: boolean,
  exitCode: number,
  commandsCompleted: number,
  checks: VerificationResult[],
  stderr: string,
): AttemptOutcome {
  const failed = checks.filter((check) => !check.pass);
  return {
    status: executionOk ? (failed.length ? "verification_failed" : "passed") : "execution_failed",
    exit_code: exitCode,
    commands_completed: commandsCompleted,
    checks_passed: checks.length - failed.length,
    checks_total: checks.length,
    failed_checks: failed,
    stderr_tail: executionOk && failed.length === 0 ? "" : lastLines(stderr),
  };
}

function rejectedExecution(error: unknown): PlanExecutionResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ok: false, exit_code: -1, timed_out: false, duration_ms: 0,
    stdout_tail: "", stderr_tail: `pre-spawn policy rejection: ${message}`,
    command_results: [],
  };
}

export async function runWithRepair(options: RepairLoopOptions): Promise<AttemptRun> {
  const originalPlan = options.initialPlan;
  let plan = options.initialPlan;
  const events: AttemptEvent[] = [];
  let measuredFailures: VerificationResult[] = [];
  let resolvedPlan = options.initialPlan;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (plan.install_cmd !== null) throw new Error("repair proposed an install that requires confirmation");
    resolvedPlan = plan;
    let execution: PlanExecutionResult;
    try {
      resolvedPlan = allocatePlanOutput(plan, options.inputPaths);
      const executablePlan = await materializePlanDerivations(
        resolvedPlan, options.inputPaths, options.profile,
      );
      execution = await executePlan(
        executablePlan, options.profile, options.inputPaths, options.executionOptions,
      );
    } catch (error) {
      execution = rejectedExecution(error);
    }
    let checks: VerificationResult[];
    if (execution.ok) {
      options.onVerificationStarted?.();
      const started = performance.now();
      checks = await verifyChecks(resolvedPlan.checks, {
        outputPath: resolvedPlan.output_path,
        sourcePaths: options.inputPaths,
        profile: options.profile,
      });
      options.onVerificationCompleted?.(Math.round(performance.now() - started));
    } else {
      checks = skippedChecks(resolvedPlan, execution.exit_code);
    }
    const attemptOutcome = outcome(
      execution.ok, execution.exit_code, execution.command_results.length,
      checks, execution.stderr_tail,
    );
    const event: AttemptEvent = {
      type: "attempt", attempt, plan_summary: summary(resolvedPlan), outcome: attemptOutcome,
    };
    events.push(event);
    options.onAttempt?.(event);
    if (attemptOutcome.status === "verification_failed") {
      measuredFailures = attemptOutcome.failed_checks;
    }
    if (attemptOutcome.status === "passed") {
      return { plan, resolvedPlan, execution, checks, all_pass: true, events };
    }
    const mayDiscardOutput = execution.command_results.length > 0;
    if (attempt === MAX_ATTEMPTS) {
      if (mayDiscardOutput) discardFailedOutput(resolvedPlan.output_path, options.inputPaths);
      return { plan, resolvedPlan, execution, checks, all_pass: false, events };
    }
    if (mayDiscardOutput) discardFailedOutput(resolvedPlan.output_path, options.inputPaths);
    const repairEvidence = attemptOutcome.status === "execution_failed" && measuredFailures.length
      ? measuredFailures : attemptOutcome.failed_checks;
    plan = enforceRepairIntegrity(originalPlan, await options.repair({
      original_plan: plan,
      failed_checks: repairEvidence,
      stderr_tail: attemptOutcome.stderr_tail,
    }));
  }
  throw new Error("repair loop exhausted unexpectedly");
}

export type { AttemptEvent, AttemptRun } from "./attempt-types.ts";
