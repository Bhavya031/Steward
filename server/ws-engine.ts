import { randomUUID } from "node:crypto";
import type { AttemptRun } from "./attempt-types.ts";
import { planRequirements } from "./installation-runtime.ts";
import type { Plan } from "./plan.ts";
import { probeSystem, type SystemProfile } from "./probe.ts";
import {
  RECIPES_DIRECTORY, load, match, rerun, save, type Recipe,
} from "./recipes.ts";
import { renderRecipe } from "./recipe-template.ts";
import { runtimeRecipeSlots } from "./recipe-runtime.ts";
import { TOOL_POLICIES } from "./tools.ts";
import type { ClientEvent, EmitServerEvent } from "./ws-events.ts";
import {
  checkResults, executionEvents, failedAttempt, pendingChecks, readableInputFiles,
} from "./ws-run-events.ts";
import { runWithRepair } from "./repair-loop.ts";
import {
  pauseForInstall, requirementsNeeded, resumeInstall, type PendingInstall,
} from "./ws-install-flow.ts";

interface Completion { outputPath: string; modelCalls?: 0 }
export type { PendingInstall } from "./ws-install-flow.ts";
export interface WsEngineOptions {
  recipeDirectory?: string;
  pendingRuns?: Map<string, PendingInstall>;
}

function activity(runId: string, message: string, emit: EmitServerEvent): void {
  emit({ type: "activity", run_id: runId, message });
}

async function runSavedReady(
  recipe: Recipe, score: number, files: string[], runId: string, emit: EmitServerEvent,
): Promise<Completion> {
  emit({
    type: "recipe_matched", run_id: runId, name: recipe.name,
    score, model_calls: 0,
  });
  pendingChecks(runId, recipe.checks, emit);
  activity(runId, "Running the saved recipe locally.", emit);
  const run = await rerun(recipe, files, {
    executionOptions: { onEvent: executionEvents(runId, emit) },
  });
  checkResults(runId, run.checks, emit);
  if (!run.all_pass) {
    throw new Error(`recipe rerun failed with exit ${run.execution.exit_code}; failed output discarded`);
  }
  return { outputPath: run.plan.output_path, modelCalls: 0 };
}

async function runSaved(
  recipe: Recipe, score: number, files: string[], runId: string, emit: EmitServerEvent,
  pendingRuns: Map<string, PendingInstall>,
): Promise<Completion | null> {
  const profile = probeSystem();
  const slots = await runtimeRecipeSlots(recipe, files, profile);
  let plan = renderRecipe(recipe, files, slots);
  const status = profile.tools.find((tool) => tool.name === plan.tool);
  if (!status?.installed) {
    const command = TOOL_POLICIES[plan.tool].install_argv;
    if (!command) throw new Error(`${plan.tool} has no installation policy`);
    plan = { ...plan, install_cmd: [...command] };
  }
  const requirements = await planRequirements(plan);
  if (requirementsNeeded(requirements)) {
    return pauseForInstall(
      runId, { kind: "saved", recipe, score, files, profile, plan, requirements },
      emit, pendingRuns,
    );
  }
  return runSavedReady(recipe, score, files, runId, emit);
}

function attemptEvents(runId: string, checks: Plan["checks"], emit: EmitServerEvent) {
  return (event: AttemptRun["events"][number]): void => {
    activity(runId, `Attempt ${event.attempt}: ${event.outcome.status.replace("_", " ")}.`, emit);
    failedAttempt(runId, event, emit);
    if (event.outcome.status !== "passed" && event.attempt < 3) pendingChecks(runId, checks, emit);
  };
}

async function runPlannedReady(
  plan: Plan, profile: SystemProfile, files: string[], directory: string,
  runId: string, emit: EmitServerEvent,
): Promise<Completion> {
  pendingChecks(runId, plan.checks, emit);
  const { repairTask } = await import("./agent.ts");
  const run = await runWithRepair({
    initialPlan: plan, profile, inputPaths: files,
    executionOptions: { onEvent: executionEvents(runId, emit) },
    onAttempt: attemptEvents(runId, plan.checks, emit),
    repair: (context) => repairTask(profile, context),
  });
  checkResults(runId, run.checks, emit);
  if (!run.all_pass) throw new Error(`all ${run.events.length} attempts failed; failed output discarded`);
  const recipe = save({
    plan: run.plan, inputPaths: files, verification: run.checks,
    arch: profile.architecture,
  }, directory);
  if (!recipe) throw new Error("green verification was refused by recipe storage");
  emit({ type: "recipe_saved", run_id: runId, recipe });
  return { outputPath: run.plan.output_path };
}

async function runPlanned(
  task: string, files: string[], directory: string, runId: string, emit: EmitServerEvent,
  pendingRuns: Map<string, PendingInstall>,
): Promise<Completion | null> {
  activity(runId, "No saved recipe matched. Reading the local system profile.", emit);
  const profile = probeSystem();
  activity(runId, `macOS ${profile.macosVersion} · ${profile.architecture} · ${profile.ram.gib} GiB.`, emit);
  activity(runId, "Planning a local command.", emit);
  const { planTask } = await import("./agent.ts");
  const planningTask = `${task}\nInput files (absolute paths): ${JSON.stringify(files)}`;
  const plan = await planTask(profile, planningTask, task);
  const requirements = await planRequirements(plan);
  if (requirementsNeeded(requirements)) {
    return pauseForInstall(
      runId, { kind: "planned", plan, profile, files, directory, requirements },
      emit, pendingRuns,
    );
  }
  return runPlannedReady(plan, profile, files, directory, runId, emit);
}

async function resume(
  request: Extract<ClientEvent, { type: "confirm_install" }>,
  emit: EmitServerEvent, pendingRuns: Map<string, PendingInstall>,
): Promise<Completion> {
  const ready = await resumeInstall(request.run_id, pendingRuns, emit);
  const pending = ready.pending;
  return pending.kind === "planned"
    ? runPlannedReady(ready.plan, ready.profile, pending.files, pending.directory, request.run_id, emit)
    : runSavedReady(pending.recipe, pending.score, pending.files, request.run_id, emit);
}

async function execute(
  request: Exclude<ClientEvent, { type: "confirm_install" }>, directory: string,
  runId: string, emit: EmitServerEvent, pendingRuns: Map<string, PendingInstall>,
): Promise<Completion | null> {
  const files = readableInputFiles(request.files);
  if (request.type === "run_recipe") {
    const recipe = load(directory).find((candidate) => candidate.name === request.name);
    if (!recipe) throw new Error(`saved recipe not found: ${request.name}`);
    return runSaved(recipe, 1, files, runId, emit, pendingRuns);
  }
  activity(runId, "Checking the local recipe shelf.", emit);
  const matched = match(request.task, files, directory);
  if (matched) return runSaved(matched.recipe, matched.confidence, files, runId, emit, pendingRuns);
  return runPlanned(request.task, files, directory, runId, emit, pendingRuns);
}

export async function runEngineEvent(
  request: ClientEvent, emit: EmitServerEvent, options: WsEngineOptions = {},
): Promise<void> {
  const pendingRuns = options.pendingRuns ?? new Map<string, PendingInstall>();
  const runId = request.type === "confirm_install" ? request.run_id : randomUUID();
  if (request.type !== "confirm_install") {
    emit({ type: "run_started", run_id: runId, action: request.type === "run_task" ? "task" : "recipe", files: [...request.files] });
  }
  try {
    const result = request.type === "confirm_install"
      ? await resume(request, emit, pendingRuns)
      : await execute(request, options.recipeDirectory ?? RECIPES_DIRECTORY, runId, emit, pendingRuns);
    if (!result) return;
    emit({
      type: "run_complete", run_id: runId, success: true, output_path: result.outputPath,
      ...(result.modelCalls === 0 ? { model_calls: 0 as const } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit({ type: "error", run_id: runId, message });
    emit({ type: "run_complete", run_id: runId, success: false });
  }
}
