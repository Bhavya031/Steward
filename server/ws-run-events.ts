import { constants, accessSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { AttemptEvent } from "./attempt-types.ts";
import type { ExecutionEvent } from "./execution-types.ts";
import type { PlanCheck } from "./plan.ts";
import type { VerificationResult } from "./verify/types.ts";
import type { EmitServerEvent } from "./ws-events.ts";

export function readableInputFiles(paths: string[]): string[] {
  return paths.map((path) => {
    if (!isAbsolute(path)) throw new Error(`input path must be absolute: ${path}`);
    const normalized = resolve(path);
    try {
      if (!statSync(normalized).isFile()) throw new Error("not a file");
      accessSync(normalized, constants.R_OK);
    } catch {
      throw new Error(`input is not a readable file: ${path}`);
    }
    return normalized;
  });
}

function displayArgument(argument: string): string {
  return /^[A-Za-z0-9_./:=+{},-]+$/.test(argument) ? argument : JSON.stringify(argument);
}

export function executionEvents(runId: string, emit: EmitServerEvent) {
  let lastProgress = 0;
  return (event: ExecutionEvent): void => {
    if (event.type === "started") {
      emit({
        type: "activity", run_id: runId,
        message: `$ ${event.argv.map(displayArgument).join(" ")}`,
      });
      return;
    }
    if (event.type === "completed") {
      emit({
        type: "activity", run_id: runId,
        message: `Command exited ${event.result.exit_code} in ${event.result.duration_ms} ms.`,
      });
      return;
    }
    const progress = event.chunk.split(/\r?\n|\r/).filter((line) =>
      /\b(?:frame|time|size)=|progress\s*=\s*\d+%/i.test(line)
    ).at(-1);
    const now = Date.now();
    if (progress && now - lastProgress >= 500) {
      lastProgress = now;
      emit({ type: "activity", run_id: runId, message: progress.trim() });
    }
  };
}

export function pendingChecks(
  runId: string, checks: PlanCheck[], emit: EmitServerEvent,
): void {
  checks.forEach((check) => emit({ type: "check_pending", run_id: runId, name: check.type }));
}

export function checkResults(
  runId: string, checks: VerificationResult[], emit: EmitServerEvent,
): void {
  checks.forEach((check) => emit({ type: "check_result", run_id: runId, ...check }));
}

export function failedAttempt(
  runId: string, event: AttemptEvent, emit: EmitServerEvent,
): void {
  if (event.outcome.status === "passed" || event.attempt >= 3) return;
  checkResults(runId, event.outcome.failed_checks, emit);
  emit({
    type: "repair_attempt", run_id: runId, attempt: event.attempt + 1,
    previous_plan: event.plan_summary,
    failed_checks: event.outcome.failed_checks,
    stderr_tail: event.outcome.stderr_tail,
  });
}
