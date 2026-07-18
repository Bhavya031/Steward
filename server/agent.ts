import { join } from "node:path";
import { buildPlannerPrompt, buildRepairPrompt, type RepairContext } from "./agent-prompts.ts";
import { type SystemProfile, probeSystem } from "./probe.ts";
import { parsePlan, PlanValidationError, type Plan } from "./plan.ts";
import { enforceRepairIntegrity } from "./repair-integrity.ts";

export const PLANNER_MODEL = "gpt-5.6-sol";
const PLAN_SCHEMA_PATH = join(import.meta.dir, "plan.schema.json");
const CODEX_TIMEOUT_MS = 5 * 60 * 1_000;

export interface CodexAuthStatus {
  authenticated: true;
  method: string;
  cliVersion: string;
}

export class AgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentError";
  }
}

function codexPath(): string {
  const path = Bun.which("codex");
  if (!path) throw new AgentError("Codex CLI is not installed or not on PATH");
  return path;
}

function fixedCodexCall(args: string[]): string {
  const result = Bun.spawnSync([codexPath(), ...args], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: 10_000,
  });
  const output = `${result.stdout.toString()}\n${result.stderr.toString()}`.trim();
  if (result.exitCode !== 0) {
    throw new AgentError(output || `codex ${args.join(" ")} failed`);
  }
  return output;
}

export function confirmCodexAuth(): CodexAuthStatus {
  const status = fixedCodexCall(["login", "status"]);
  if (!/^Logged in using /m.test(status)) {
    throw new AgentError(`Codex CLI authentication is unavailable: ${status}`);
  }
  return {
    authenticated: true,
    method: status.match(/^Logged in using (.+)$/m)?.[1] ?? "unknown",
    cliVersion: fixedCodexCall(["--version"]),
  };
}

async function runCodex(prompt: string): Promise<string> {
  const child = Bun.spawn(
    [
      codexPath(), "exec", "--ephemeral", "--sandbox", "read-only",
      "--model", PLANNER_MODEL, "--color", "never",
      "--output-schema", PLAN_SCHEMA_PATH, prompt,
    ],
    { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
  );
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, CODEX_TIMEOUT_MS);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  clearTimeout(timer);
  if (timedOut) throw new AgentError("Codex planning timed out after 5 minutes");
  if (exitCode !== 0) {
    throw new AgentError(`Codex planning failed (${exitCode}): ${stderr.slice(-4_000)}`);
  }
  return stdout;
}

export function validatePlanForProfile(plan: Plan, profile: SystemProfile): Plan {
  const status = profile.tools.find((tool) => tool.name === plan.tool);
  if (!status) throw new PlanValidationError(`No probe status for ${plan.tool}`);
  if (status.installed && plan.install_cmd !== null) {
    throw new PlanValidationError(`${plan.tool} is installed; install_cmd must be null`);
  }
  if (!status.installed && plan.install_cmd === null) {
    throw new PlanValidationError(`${plan.tool} is missing; install_cmd is required`);
  }
  for (const command of plan.commands.slice(0, -1)) {
    const ancillary = command[0] as Plan["tool"];
    const ancillaryStatus = profile.tools.find((tool) => tool.name === ancillary);
    if (!ancillaryStatus?.installed) {
      throw new PlanValidationError(`ancillary tool ${ancillary} must already be installed`);
    }
  }
  return plan;
}

function parseForProfile(raw: string, profile: SystemProfile): Plan {
  return validatePlanForProfile(parsePlan(raw), profile);
}

function taskSlug(task: string): string {
  return task.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
}

export function validatePlanNameForTask(plan: Plan, taskDescription: string): Plan {
  if (plan.name === taskSlug(taskDescription)) {
    throw new PlanValidationError("name must describe the transformation, not repeat the task wording as a slug");
  }
  return plan;
}

export async function planTask(
  profile: SystemProfile,
  task: string,
  taskDescription = task,
): Promise<Plan> {
  if (!task.trim()) throw new AgentError("Task must not be empty");
  confirmCodexAuth();
  const first = await runCodex(buildPlannerPrompt(profile, task));
  try {
    return validatePlanNameForTask(parseForProfile(first, profile), taskDescription);
  } catch (error) {
    if (!(error instanceof PlanValidationError)) throw error;
    const second = await runCodex(buildPlannerPrompt(profile, task, error.message));
    return validatePlanNameForTask(parseForProfile(second, profile), taskDescription);
  }
}

export async function repairTask(profile: SystemProfile, context: RepairContext): Promise<Plan> {
  confirmCodexAuth();
  const first = await runCodex(buildRepairPrompt(profile, context));
  try {
    return enforceRepairIntegrity(context.original_plan, parseForProfile(first, profile));
  } catch (error) {
    if (!(error instanceof PlanValidationError)) throw error;
    const second = await runCodex(buildRepairPrompt(profile, context, error.message));
    return enforceRepairIntegrity(context.original_plan, parseForProfile(second, profile));
  }
}

export type { RepairContext } from "./agent-prompts.ts";

if (import.meta.main) {
  const task = Bun.argv.slice(2).join(" ").trim();
  const auth = confirmCodexAuth();
  console.error(`Codex: ${auth.cliVersion}; authenticated via ${auth.method}`);
  console.log(JSON.stringify(await planTask(probeSystem(), task), null, 2));
}
