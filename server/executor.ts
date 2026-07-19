import { constants, accessSync } from "node:fs";
import { compositionOutputRoots } from "./composition-output-root.ts";
import { ExecutionCancelledError, ExecutionError, MAX_EXECUTION_MS, type ExecutionEvent, type ExecutionOptions, type ExecutionResult, type PlanExecutionResult } from "./execution-types.ts";
import { boundedTimeout, resolveBinary, summarizeExecution } from "./execution-policy.ts";
import { buildGhostscriptDocumentCommand, type GhostscriptDocumentQuery } from "./document-policy.ts";
import { HELPER_PATHS, validateHelperStep } from "./helper-policy.ts";
import { buildFfprobeCommand, type FfprobeQuery } from "./ffprobe-policy.ts";
import { validateInstallProposal } from "./install-policy.ts";
import { buildLoudnessCommand } from "./loudness-policy.ts";
import type { SystemProfile } from "./probe.ts";
import { validatePlan, type Plan } from "./plan.ts";
import { validatePlanPaths } from "./plan-paths.ts";
import {
  OwnedProcessCancellation, throwIfStewardCancelled,
} from "./process-cancellation.ts";
import { startProcessStreamConsumption } from "./process-stream.ts";
import { createSofficeProfile } from "./soffice-profile.ts";
import { materializeRuntimeCommands } from "./runtime-temp.ts";
import { enforceManagedPasslogs } from "./two-pass-policy.ts";
import { fillResourceSlots, resourceSlots } from "./trusted-resources.ts";

export { ExecutionCancelledError, ExecutionError, MAX_EXECUTION_MS, type ExecutionEvent, type ExecutionOptions, type ExecutionResult, type PlanExecutionResult } from "./execution-types.ts";
async function runBinary(
  binary: string, executable: string, args: string[], options: ExecutionOptions,
): Promise<ExecutionResult> {
  throwIfStewardCancelled(options.signal);
  const timeoutMs = boundedTimeout(options.timeoutMs);
  const emit = options.onEvent ?? (() => undefined);
  const started = performance.now();
  const child = Bun.spawn([executable, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  let forceTimer: ReturnType<typeof setTimeout> | undefined;
  const terminate = (): void => {
    child.kill();
    forceTimer ??= setTimeout(() => child.kill(9), 2_000);
  };
  const timeout = setTimeout(() => {
    timedOut = true;
    terminate();
  }, timeoutMs);
  const cancellation = new OwnedProcessCancellation(child, options.signal);
  const stdout = startProcessStreamConsumption(child.stdout, "stdout", emit);
  const stderr = startProcessStreamConsumption(child.stderr, "stderr", emit);
  cancellation.addReader(stdout.cancel);
  cancellation.addReader(stderr.cancel);

  try {
    emit({ type: "started", argv: [binary, ...args] });
    const normal = Promise.all([
      stdout.completion, stderr.completion, child.exited,
    ]).then(
      ([stdoutTail, stderrTail, exitCode]) => ({
        kind: "completed" as const, stdoutTail, stderrTail, exitCode,
      }),
      (error) => ({ kind: "failed" as const, error }),
    );
    const winner = await Promise.race([
      normal,
      cancellation.aborted.then((error) => ({ kind: "aborted" as const, error })),
    ]);
    if (winner.kind === "aborted") throw await cancellation.settleAbort();
    if (winner.kind === "failed") throw winner.error;
    throwIfStewardCancelled(options.signal);
    const result: ExecutionResult = {
      ok: winner.exitCode === 0 && !timedOut,
      exit_code: winner.exitCode,
      timed_out: timedOut,
      duration_ms: Math.round(performance.now() - started),
      stdout_tail: winner.stdoutTail,
      stderr_tail: winner.stderrTail,
    };
    emit({ type: "completed", result });
    return result;
  } catch (error) {
    if (error instanceof ExecutionCancelledError) {
      throw await cancellation.settleAbort();
    }
    child.kill(9);
    await child.exited;
    throw new ExecutionError(
      `execution event handling failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    cancellation.dispose();
    clearTimeout(timeout);
    if (forceTimer) clearTimeout(forceTimer);
  }
}
export async function executePlan(
  untrustedPlan: unknown,
  profile: SystemProfile,
  inputPaths: unknown,
  options: ExecutionOptions = {},
  outputRootCapability?: unknown,
): Promise<PlanExecutionResult> {
  throwIfStewardCancelled(options.signal);
  const plan: Plan = validatePlan(untrustedPlan);
  if (plan.install_cmd !== null) {
    throw new ExecutionError("install proposal must be handled before task execution");
  }
  const resources = await resourceSlots(plan.resources);
  throwIfStewardCancelled(options.signal);
  if (resources.missing.length > 0) {
    throw new ExecutionError(`trusted resources require installation: ${resources.missing.join(", ")}`);
  }
  const timeoutMs = boundedTimeout(options.timeoutMs);
  const additionalOutputRoots = outputRootCapability === undefined
    ? [] : compositionOutputRoots(outputRootCapability);
  const commands = fillResourceSlots(plan.commands, resources.slots);
  const runtime = materializeRuntimeCommands(commands, plan.intermediates);
  const isolatedProfile = commands.some((command) => command[0] === "soffice")
    ? createSofficeProfile() : null;
  try {
    enforceManagedPasslogs(runtime.commands, runtime.directory);
    validatePlanPaths(plan, runtime, inputPaths, resources.trustedPaths, additionalOutputRoots);
    const results: ExecutionResult[] = [];
    const started = performance.now();
    for (const command of runtime.commands) {
      throwIfStewardCancelled(options.signal);
      const tool = command[0] as Plan["tool"];
      const executable = resolveBinary(tool, profile);
      const remaining = Math.max(1, timeoutMs - Math.round(performance.now() - started));
      const args = isolatedProfile && tool === "soffice"
        ? [isolatedProfile.argument, ...command.slice(1)]
        : command.slice(1);
      const result = await runBinary(tool, executable, args, { ...options, timeoutMs: remaining });
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
