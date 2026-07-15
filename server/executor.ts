import { constants, accessSync } from "node:fs";
import { ExecutionError, MAX_EXECUTION_MS, type ExecutionEvent, type ExecutionOptions, type ExecutionResult, type PlanExecutionResult } from "./execution-types.ts";
import { boundedTimeout, resolveBinary, summarizeExecution } from "./execution-policy.ts";
import { buildGhostscriptDocumentCommand, type GhostscriptDocumentQuery } from "./document-policy.ts";
import { HELPER_PATHS, validateHelperStep } from "./helper-policy.ts";
import { buildFfprobeCommand, type FfprobeQuery } from "./ffprobe-policy.ts";
import { validateInstallProposal } from "./install-policy.ts";
import { buildLoudnessCommand } from "./loudness-policy.ts";
import type { SystemProfile } from "./probe.ts";
import { validatePlan, type Plan } from "./plan.ts";
import { validatePlanPaths } from "./plan-paths.ts";
import { consumeProcessStream } from "./process-stream.ts";
import { createSofficeProfile } from "./soffice-profile.ts";
import { materializeRuntimeCommands } from "./runtime-temp.ts";
import { enforceManagedPasslogs } from "./two-pass-policy.ts";

export { ExecutionError, MAX_EXECUTION_MS, type ExecutionEvent, type ExecutionOptions, type ExecutionResult, type PlanExecutionResult } from "./execution-types.ts";

async function runBinary(
  binary: string, executable: string, args: string[], options: ExecutionOptions,
): Promise<ExecutionResult> {
  const timeoutMs = boundedTimeout(options.timeoutMs);
  const emit = options.onEvent ?? (() => undefined);
  const started = performance.now();
  const child = Bun.spawn([executable, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  let forceTimer: ReturnType<typeof setTimeout> | undefined;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill();
    forceTimer = setTimeout(() => child.kill(9), 2_000);
  }, timeoutMs);

  try {
    emit({ type: "started", argv: [binary, ...args] });
    const [stdoutTail, stderrTail, exitCode] = await Promise.all([
      consumeProcessStream(child.stdout, "stdout", emit),
      consumeProcessStream(child.stderr, "stderr", emit),
      child.exited,
    ]);
    const result: ExecutionResult = {
      ok: exitCode === 0 && !timedOut,
      exit_code: exitCode,
      timed_out: timedOut,
      duration_ms: Math.round(performance.now() - started),
      stdout_tail: stdoutTail,
      stderr_tail: stderrTail,
    };
    emit({ type: "completed", result });
    return result;
  } catch (error) {
    child.kill(9);
    await child.exited;
    throw new ExecutionError(
      `execution event handling failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timeout);
    if (forceTimer) clearTimeout(forceTimer);
  }
}

export async function executePlan(
  untrustedPlan: unknown,
  profile: SystemProfile,
  inputPaths: unknown,
  options: ExecutionOptions = {},
): Promise<PlanExecutionResult> {
  const plan: Plan = validatePlan(untrustedPlan);
  if (plan.install_cmd !== null) {
    throw new ExecutionError("install proposal must be handled before task execution");
  }
  const timeoutMs = boundedTimeout(options.timeoutMs);
  const runtime = materializeRuntimeCommands(plan.commands, plan.intermediates);
  const isolatedProfile = plan.tool === "soffice" ? createSofficeProfile() : null;
  try {
    enforceManagedPasslogs(runtime.commands, runtime.directory);
    validatePlanPaths(plan, runtime, inputPaths);
    const executable = resolveBinary(plan.tool, profile);
    const results: ExecutionResult[] = [];
    const started = performance.now();
    for (const command of runtime.commands) {
      const remaining = Math.max(1, timeoutMs - Math.round(performance.now() - started));
      const args = isolatedProfile
        ? [isolatedProfile.argument, ...command.slice(1)]
        : command.slice(1);
      const result = await runBinary(plan.tool, executable, args, { ...options, timeoutMs: remaining });
      results.push(result);
      if (!result.ok) break;
    }
    return summarizeExecution(results, runtime.commands.length);
  } finally {
    isolatedProfile?.cleanup();
    runtime.cleanup();
  }
}

export async function executeInstall(
  tool: unknown, proposedArgv: unknown, profile: SystemProfile, heavyConfirmed: unknown,
  options: ExecutionOptions = {},
): Promise<ExecutionResult> {
  const install = validateInstallProposal(tool, proposedArgv, profile, heavyConfirmed);
  return runBinary("brew", resolveBinary("brew", profile), install.argv.slice(1), options);
}

export async function executeHelperStep(
  untrustedStep: unknown, grants: unknown,
  options: ExecutionOptions = {},
): Promise<ExecutionResult> {
  const step = validateHelperStep(untrustedStep, grants);
  const executable = HELPER_PATHS[step.tool];
  try {
    accessSync(executable, constants.X_OK);
  } catch {
    throw new ExecutionError(`${step.tool} is not executable at ${executable}`);
  }
  return runBinary(step.tool, executable, step.command.slice(1), options);
}

export async function executeFfprobe(
  query: FfprobeQuery, inputPath: unknown, profile: SystemProfile,
  options: ExecutionOptions = {},
): Promise<ExecutionResult> {
  const command = buildFfprobeCommand(query, inputPath);
  return runBinary("ffprobe", resolveBinary("ffprobe", profile), command.slice(1), options);
}

export async function executeLoudnessScan(
  inputPath: unknown, profile: SystemProfile,
  options: ExecutionOptions = {},
): Promise<ExecutionResult> {
  const command = buildLoudnessCommand(inputPath);
  return runBinary("ffmpeg", resolveBinary("ffmpeg", profile), command.slice(1), options);
}

export async function executeGhostscriptDocument(
  query: GhostscriptDocumentQuery, inputPath: unknown, profile: SystemProfile,
  options: ExecutionOptions = {},
): Promise<ExecutionResult> {
  const command = buildGhostscriptDocumentCommand(query, inputPath);
  return runBinary("gs", resolveBinary("gs", profile), command.slice(1), options);
}
