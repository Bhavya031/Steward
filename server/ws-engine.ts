import { randomUUID } from "node:crypto";
import type { AttemptRun } from "./attempt-types.ts";
import { probeSystem } from "./probe.ts";
import { runWithRepair } from "./repair-loop.ts";
import {
  RECIPES_DIRECTORY, load, match, rerun, save, type Recipe,
} from "./recipes.ts";
import type { ClientEvent, EmitServerEvent } from "./ws-events.ts";
import {
  checkResults, executionEvents, failedAttempt, pendingChecks, readableInputFiles,
} from "./ws-run-events.ts";

export interface WsEngineOptions { recipeDirectory?: string }
interface Completion { outputPath: string; modelCalls?: 0 }

function activity(runId: string, message: string, emit: EmitServerEvent): void {
  emit({ type: "activity", run_id: runId, message });
}

async function runSaved(
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

function attemptEvents(
  runId: string, checks: AttemptRun["plan"]["checks"], emit: EmitServerEvent,
) {
  return (event: AttemptRun["events"][number]): void => {
    activity(runId, `Attempt ${event.attempt}: ${event.outcome.status.replace("_", " ")}.`, emit);
    failedAttempt(runId, event, emit);
    if (event.outcome.status !== "passed" && event.attempt < 3) {
      pendingChecks(runId, checks, emit);
    }
  };
}

async function runPlanned(
  task: string, files: string[], directory: string, runId: string, emit: EmitServerEvent,
): Promise<Completion> {
  activity(runId, "No saved recipe matched. Reading the local system profile.", emit);
  const profile = probeSystem();
  activity(
    runId,
    `macOS ${profile.macosVersion} · ${profile.architecture} · ${profile.ram.gib} GiB.`,
    emit,
  );
  activity(runId, "Planning a local command.", emit);
  const { planTask, repairTask } = await import("./agent.ts");
  const planningTask = `${task}\nInput files (absolute paths): ${JSON.stringify(files)}`;
  const initialPlan = await planTask(profile, planningTask, task);
  if (initialPlan.install_cmd) {
    throw new Error(`install requires confirmation: ${JSON.stringify(initialPlan.install_cmd)}`);
  }
  pendingChecks(runId, initialPlan.checks, emit);
  const run = await runWithRepair({
    initialPlan, profile, inputPaths: files,
    executionOptions: { onEvent: executionEvents(runId, emit) },
    onAttempt: attemptEvents(runId, initialPlan.checks, emit),
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

async function execute(
  request: ClientEvent, directory: string, runId: string, emit: EmitServerEvent,
): Promise<Completion> {
  const files = readableInputFiles(request.files);
  if (request.type === "run_recipe") {
    const recipe = load(directory).find((candidate) => candidate.name === request.name);
    if (!recipe) throw new Error(`saved recipe not found: ${request.name}`);
    return runSaved(recipe, 1, files, runId, emit);
  }
  activity(runId, "Checking the local recipe shelf.", emit);
  const matched = match(request.task, files, directory);
  if (matched) return runSaved(matched.recipe, matched.confidence, files, runId, emit);
  return runPlanned(request.task, files, directory, runId, emit);
}

export async function runEngineEvent(
  request: ClientEvent, emit: EmitServerEvent, options: WsEngineOptions = {},
): Promise<void> {
  const runId = randomUUID();
  emit({
    type: "run_started", run_id: runId,
    action: request.type === "run_task" ? "task" : "recipe",
    files: [...request.files],
  });
  try {
    const result = await execute(
      request, options.recipeDirectory ?? RECIPES_DIRECTORY, runId, emit,
    );
    emit({
      type: "run_complete", run_id: runId, success: true,
      output_path: result.outputPath,
      ...(result.modelCalls === 0 ? { model_calls: 0 as const } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit({ type: "error", run_id: runId, message });
    emit({ type: "run_complete", run_id: runId, success: false });
  }
}
