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
import {
  handlesCompositionEvent, runCompositionProtocolEvent,
  type WsCompositionOptions,
} from "./ws-composition.ts";
import type {
  ClientEvent, EmitServerEvent, EmitWsEvent, WsClientEvent,
} from "./ws-events.ts";
import {
  checkResults, executionEvents, failedAttempt, pendingChecks, readableInputFiles,
} from "./ws-run-events.ts";
import { runWithRepair } from "./repair-loop.ts";
import {
  pauseForInstall, requirementsNeeded, resumeInstall, type PendingInstall,
} from "./ws-install-flow.ts";
import { userFacingMessage } from "./user-facing.ts";

interface Completion { outputPath: string; modelCalls?: number }
type SavedSelection = { kind: "matched"; score: number } | { kind: "direct" };
export type { PendingInstall } from "./ws-install-flow.ts";
export interface WsEngineOptions extends WsCompositionOptions {
  pendingRuns?: Map<string, PendingInstall>;
}

function activity(runId: string, message: string, emit: EmitServerEvent): void {
  emit({ type: "activity", run_id: runId, message });
}

function verificationEvents(runId: string, emit: EmitServerEvent) {
  return {
    onVerificationStarted: () => emit({ type: "verification_started", run_id: runId }),
    onVerificationCompleted: (duration_ms: number) =>
      emit({ type: "verification_completed", run_id: runId, duration_ms }),
  };
}

async function runSavedReady(
  recipe: Recipe, selection: SavedSelection, files: string[], runId: string,
  emit: EmitServerEvent, profile?: SystemProfile,
): Promise<Completion> {
  if (selection.kind === "matched") {
    emit({
      type: "recipe_matched", run_id: runId, name: recipe.name,
      score: selection.score, model_calls: 0,
    });
  } else {
    emit({
      type: "workflow_selected", run_id: runId,
      workflow_id: recipe.name, model_calls: 0,
    });
  }
  pendingChecks(runId, recipe.checks, emit);
  activity(runId, "Saved plan ready. Preparing local execution.", emit);
  const run = await rerun(recipe, files, {
    ...(profile ? { profile } : {}),
    executionOptions: { onEvent: executionEvents(runId, emit) },
    ...verificationEvents(runId, emit),
  });
  checkResults(runId, run.checks, emit);
  if (!run.all_pass) {
    throw new Error(`saved workflow failed with exit ${run.execution.exit_code}; failed output discarded`);
  }
  return { outputPath: run.plan.output_path, modelCalls: 0 };
}

async function runSaved(
  recipe: Recipe, selection: SavedSelection, files: string[], runId: string,
  emit: EmitServerEvent,
  pendingRuns: Map<string, PendingInstall>,
  suppliedProfile?: SystemProfile,
): Promise<Completion | null> {
  const profile = suppliedProfile ?? probeSystem();
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
      runId, { kind: "saved", recipe, selection, files, profile, plan, requirements },
      emit, pendingRuns,
    );
  }
  return runSavedReady(recipe, selection, files, runId, emit, profile);
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
  taskDescription: string, initialModelCalls: number, runId: string, emit: EmitServerEvent,
): Promise<Completion> {
  let modelCalls = initialModelCalls;
  const onModelCall = () => {
    modelCalls += 1;
    emit({ type: "model_call_count", run_id: runId, model_calls: modelCalls });
  };
  pendingChecks(runId, plan.checks, emit);
  const { repairTask } = await import("./agent.ts");
  const run = await runWithRepair({
    initialPlan: plan, profile, inputPaths: files,
    executionOptions: { onEvent: executionEvents(runId, emit) },
    ...verificationEvents(runId, emit),
    onAttempt: attemptEvents(runId, plan.checks, emit),
    repair: (context) => repairTask(profile, context, onModelCall),
  });
  checkResults(runId, run.checks, emit);
  if (!run.all_pass) throw new Error(`all ${run.events.length} attempts failed; failed output discarded`);
  const recipe = save({
    plan: run.plan, taskDescription, inputPaths: files, verification: run.checks,
    arch: profile.architecture,
  }, directory);
  if (!recipe) throw new Error("green verification was refused by saved-workflow storage");
  emit({ type: "recipe_saved", run_id: runId, recipe });
  return { outputPath: run.resolvedPlan.output_path, modelCalls };
}

async function runPlanned(
  task: string, files: string[], directory: string, runId: string, emit: EmitServerEvent,
  pendingRuns: Map<string, PendingInstall>, suppliedProfile?: SystemProfile,
): Promise<Completion | null> {
  activity(runId, "No saved workflow matched. Reading the local system profile.", emit);
  const profile = suppliedProfile ?? probeSystem();
  activity(runId, `macOS ${profile.macosVersion} · ${profile.architecture} · ${profile.ram.gib} GiB.`, emit);
  activity(runId, "Planning a local command.", emit);
  const { planTask } = await import("./agent.ts");
  let modelCalls = 0;
  const onModelCall = () => {
    modelCalls += 1;
    emit({ type: "model_call_count", run_id: runId, model_calls: modelCalls });
  };
  const planningTask = `${task}\nInput files (absolute paths): ${JSON.stringify(files)}`;
  const plan = await planTask(profile, planningTask, task, onModelCall);
  activity(runId, "Plan ready. Preparing local execution.", emit);
  const requirements = await planRequirements(plan);
  if (requirementsNeeded(requirements)) {
    return pauseForInstall(
      runId, {
        kind: "planned", plan, profile, files, directory, taskDescription: task,
        modelCalls, requirements,
      },
      emit, pendingRuns,
    );
  }
  return runPlannedReady(plan, profile, files, directory, task, modelCalls, runId, emit);
}

async function resume(
  request: Extract<ClientEvent, { type: "confirm_install" }>,
  emit: EmitServerEvent, pendingRuns: Map<string, PendingInstall>,
): Promise<Completion> {
  const ready = await resumeInstall(request.run_id, pendingRuns, emit);
  const pending = ready.pending;
  return pending.kind === "planned"
    ? runPlannedReady(
      ready.plan, ready.profile, pending.files, pending.directory,
      pending.taskDescription, pending.modelCalls, request.run_id, emit,
    )
    : runSavedReady(
      pending.recipe, pending.selection, pending.files,
      request.run_id, emit, ready.profile,
    );
}

async function execute(
  request: Exclude<ClientEvent, { type: "confirm_install" }>, directory: string,
  runId: string, emit: EmitServerEvent, pendingRuns: Map<string, PendingInstall>,
  suppliedProfile?: SystemProfile,
): Promise<Completion | null> {
  const files = readableInputFiles(request.files);
  if (request.type === "run_saved_workflow") {
    const recipe = load(directory).find((candidate) => candidate.name === request.workflow_id);
    if (!recipe) throw new Error(`saved workflow not found: ${request.workflow_id}`);
    return runSaved(
      recipe, { kind: "direct" }, files, runId, emit, pendingRuns, suppliedProfile,
    );
  }
  activity(runId, "Checking saved workflows on this Mac.", emit);
  const matched = match(request.task, files, directory);
  if (matched) {
    return runSaved(
      matched.recipe, { kind: "matched", score: matched.confidence },
      files, runId, emit, pendingRuns, suppliedProfile,
    );
  }
  return runPlanned(
    request.task, files, directory, runId, emit, pendingRuns, suppliedProfile,
  );
}

export function runEngineEvent(
  request: ClientEvent, emit: EmitServerEvent, options?: WsEngineOptions,
): Promise<void>;
export function runEngineEvent(
  request: WsClientEvent, emit: EmitWsEvent, options?: WsEngineOptions,
): Promise<void>;
export async function runEngineEvent(
  request: WsClientEvent,
  emit: EmitServerEvent | EmitWsEvent,
  options: WsEngineOptions = {},
): Promise<void> {
  const pendingCompositionRuns = options.pendingCompositionRuns ?? new Map();
  if (handlesCompositionEvent(request, pendingCompositionRuns)) {
    await runCompositionProtocolEvent(request, emit as EmitWsEvent, {
      ...options, pendingCompositionRuns,
    });
    return;
  }
  const legacyRequest = request as ClientEvent;
  const legacyEmit = emit as EmitServerEvent;
  const pendingRuns = options.pendingRuns ?? new Map<string, PendingInstall>();
  const runId = legacyRequest.type === "confirm_install" ? legacyRequest.run_id : randomUUID();
  if (legacyRequest.type !== "confirm_install") {
    legacyEmit({
      type: "run_started", run_id: runId,
      action: legacyRequest.type === "run_task" ? "task" : "recipe",
      files: [...legacyRequest.files],
    });
  }
  try {
    const result = legacyRequest.type === "confirm_install"
      ? await resume(legacyRequest, legacyEmit, pendingRuns)
      : await execute(
        legacyRequest, options.recipeDirectory ?? RECIPES_DIRECTORY,
        runId, legacyEmit, pendingRuns, options.profile,
      );
    if (!result) return;
    legacyEmit({
      type: "run_complete", run_id: runId, success: true, output_path: result.outputPath,
      ...(result.modelCalls === undefined ? {} : { model_calls: result.modelCalls }),
    });
  } catch (error) {
    legacyEmit({ type: "error", run_id: runId, message: userFacingMessage(error) });
    legacyEmit({ type: "run_complete", run_id: runId, success: false });
  }
}
