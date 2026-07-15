import { constants, accessSync } from "node:fs";
import { ExecutionError, MAX_EXECUTION_MS, type ExecutionEvent, type ExecutionOptions, type ExecutionResult } from "./execution-types.ts";
import { HELPER_PATHS, validateHelperStep } from "./helper-policy.ts";
import { buildFfprobeCommand, type FfprobeQuery } from "./ffprobe-policy.ts";
import { validateInstallProposal } from "./install-policy.ts";
import type { SystemProfile } from "./probe.ts";
import { validatePlan, type Plan } from "./plan.ts";
import { validateCommandPaths } from "./path-policy.ts";
import { consumeProcessStream } from "./process-stream.ts";
import { createSofficeProfile } from "./soffice-profile.ts";
import type { AllowedBinary } from "./tools.ts";

export { ExecutionError, MAX_EXECUTION_MS, type ExecutionEvent, type ExecutionOptions, type ExecutionResult } from "./execution-types.ts";

function resolveBinary(binary: AllowedBinary, profile: SystemProfile): string {
  const status =
    binary === "brew"
      ? profile.brew
      : profile.tools.find((tool) => tool.name === binary);
  if (!status?.installed || !status.binary) {
    throw new ExecutionError(`${binary} is not installed`);
  }
  try {
    accessSync(status.binary, constants.X_OK);
  } catch {
    throw new ExecutionError(`${binary} is not executable at ${status.binary}`);
  }
  return status.binary;
}

function boundedTimeout(requested = MAX_EXECUTION_MS): number {
  if (!Number.isInteger(requested) || requested <= 0 || requested > MAX_EXECUTION_MS) {
    throw new ExecutionError("timeout must be between 1 ms and 30 minutes");
  }
  return requested;
}

async function runBinary(
  binary: string,
  executable: string,
  args: string[],
  options: ExecutionOptions,
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
): Promise<ExecutionResult> {
  const plan: Plan = validatePlan(untrustedPlan);
  if (plan.install_cmd !== null) {
    throw new ExecutionError("install proposal must be handled before task execution");
  }
  validateCommandPaths(plan.tool, plan.command, inputPaths, plan.output_path);
  const args = plan.command.slice(1);
  const executable = resolveBinary(plan.tool, profile);
  if (plan.tool !== "soffice") return runBinary(plan.tool, executable, args, options);
  const isolatedProfile = createSofficeProfile();
  try {
    return await runBinary(
      plan.tool,
      executable,
      [isolatedProfile.argument, ...args],
      options,
    );
  } finally {
    isolatedProfile.cleanup();
  }
}

export async function executeInstall(
  tool: unknown,
  proposedArgv: unknown,
  profile: SystemProfile,
  heavyConfirmed: unknown,
  options: ExecutionOptions = {},
): Promise<ExecutionResult> {
  const install = validateInstallProposal(tool, proposedArgv, profile, heavyConfirmed);
  return runBinary("brew", resolveBinary("brew", profile), install.argv.slice(1), options);
}

export async function executeHelperStep(
  untrustedStep: unknown,
  grants: unknown,
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
  query: FfprobeQuery,
  inputPath: unknown,
  profile: SystemProfile,
  options: ExecutionOptions = {},
): Promise<ExecutionResult> {
  const command = buildFfprobeCommand(query, inputPath);
  return runBinary("ffprobe", resolveBinary("ffprobe", profile), command.slice(1), options);
}
