import { constants, accessSync } from "node:fs";
import { ExecutionError, MAX_EXECUTION_MS, type ExecutionResult, type PlanExecutionResult } from "./execution-types.ts";
import type { SystemProfile } from "./probe.ts";
import type { AllowedBinary } from "./tools.ts";

export function resolveBinary(binary: AllowedBinary, profile: SystemProfile): string {
  const status = binary === "brew"
    ? profile.brew
    : profile.tools.find((tool) => tool.name === binary);
  if (!status?.installed || !status.binary) throw new ExecutionError(`${binary} is not installed`);
  try {
    accessSync(status.binary, constants.X_OK);
  } catch {
    throw new ExecutionError(`${binary} is not executable at ${status.binary}`);
  }
  return status.binary;
}

export function boundedTimeout(requested = MAX_EXECUTION_MS): number {
  if (!Number.isInteger(requested) || requested <= 0 || requested > MAX_EXECUTION_MS) {
    throw new ExecutionError("timeout must be between 1 ms and 30 minutes");
  }
  return requested;
}

export function summarizeExecution(
  results: ExecutionResult[],
  expectedCommands: number,
): PlanExecutionResult {
  const last = results.at(-1);
  const joinTail = (key: "stdout_tail" | "stderr_tail"): string =>
    results.map((result) => result[key]).filter(Boolean).join("\n").slice(-64 * 1_024);
  return {
    ok: results.length === expectedCommands && results.every((result) => result.ok),
    exit_code: last?.exit_code ?? -1,
    timed_out: results.some((result) => result.timed_out),
    duration_ms: results.reduce((total, result) => total + result.duration_ms, 0),
    stdout_tail: joinTail("stdout_tail"),
    stderr_tail: joinTail("stderr_tail"),
    command_results: results,
  };
}
