import { constants, accessSync } from "node:fs";
import { ExecutionError, MAX_EXECUTION_MS, type ExecutionEvent, type ExecutionOptions, type ExecutionResult } from "./execution-types.ts";
import { validateInstallProposal } from "./install-policy.ts";
import type { SystemProfile } from "./probe.ts";
import { validatePlan, type Plan } from "./plan.ts";
import { validateCommandPaths } from "./path-policy.ts";
import { createSofficeProfile } from "./soffice-profile.ts";
import type { AllowedBinary } from "./tools.ts";

export { ExecutionError, MAX_EXECUTION_MS, type ExecutionEvent, type ExecutionOptions, type ExecutionResult } from "./execution-types.ts";
const MAX_CAPTURE_CHARS = 64 * 1_024;

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

function appendTail(current: string, chunk: string): string {
  return `${current}${chunk}`.slice(-MAX_CAPTURE_CHARS);
}

async function consume(
  stream: ReadableStream<Uint8Array>,
  type: "stdout" | "stderr",
  emit: (event: ExecutionEvent) => void,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let tail = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    tail = appendTail(tail, chunk);
    emit({ type, chunk });
  }
  const final = decoder.decode();
  if (final) {
    tail = appendTail(tail, final);
    emit({ type, chunk: final });
  }
  return tail;
}

async function runBinary(
  binary: AllowedBinary,
  args: string[],
  profile: SystemProfile,
  options: ExecutionOptions,
): Promise<ExecutionResult> {
  const executable = resolveBinary(binary, profile);
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
      consume(child.stdout, "stdout", emit),
      consume(child.stderr, "stderr", emit),
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
  if (plan.tool !== "soffice") return runBinary(plan.tool, args, profile, options);
  const isolatedProfile = createSofficeProfile();
  try {
    return await runBinary(
      plan.tool,
      [isolatedProfile.argument, ...args],
      profile,
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
  return runBinary("brew", install.argv.slice(1), profile, options);
}
