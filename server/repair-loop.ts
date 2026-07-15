import type { RepairContext } from "./agent-prompts.ts";
import type { AttemptEvent, AttemptOutcome, AttemptRun, PlanSummary } from "./attempt-types.ts";
import { discardFailedOutput } from "./failed-output.ts";
import { executePlan, type ExecutionOptions } from "./executor.ts";
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

export async function runWithRepair(options: RepairLoopOptions): Promise<AttemptRun> {
  const originalPlan = options.initialPlan;
  let plan = options.initialPlan;
  const events: AttemptEvent[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (plan.install_cmd !== null) throw new Error("repair proposed an install that requires confirmation");
    const execution = await executePlan(
      plan, options.profile, options.inputPaths, options.executionOptions,
    );
    const checks = execution.ok
      ? await verifyChecks(plan.checks, {
        outputPath: plan.output_path,
        sourcePaths: options.inputPaths,
        profile: options.profile,
      })
      : skippedChecks(plan, execution.exit_code);
    const attemptOutcome = outcome(
      execution.ok, execution.exit_code, execution.command_results.length,
      checks, execution.stderr_tail,
    );
    const event: AttemptEvent = {
      type: "attempt", attempt, plan_summary: summary(plan), outcome: attemptOutcome,
    };
    events.push(event);
    options.onAttempt?.(event);
    if (attemptOutcome.status === "passed") {
      return { plan, execution, checks, all_pass: true, events };
    }
    if (attempt === MAX_ATTEMPTS) {
      discardFailedOutput(plan.output_path, options.inputPaths);
      return { plan, execution, checks, all_pass: false, events };
    }
    discardFailedOutput(plan.output_path, options.inputPaths);
    plan = enforceRepairIntegrity(originalPlan, await options.repair({
      original_plan: plan,
      failed_checks: attemptOutcome.failed_checks,
      stderr_tail: attemptOutcome.stderr_tail,
    }));
  }
  throw new Error("repair loop exhausted unexpectedly");
}

export type { AttemptEvent, AttemptRun } from "./attempt-types.ts";
