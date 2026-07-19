import { derived, get, readable, writable } from "svelte/store";
import type { WsClientEvent, WsServerEvent } from "../../../server/ws-events.ts";
import type { ComposableCatalogEntry } from "../../../server/composition-catalog.ts";
import {
  compositionFromDetail, compositionSummary, savedComposition, selectedStageSnapshots,
  type CompositionCommand, type CompositionStageView, type SavedCommand,
} from "./composition-model.ts";
import {
  createRunProgress, reduceClientEvent, reduceServerEvent,
} from "./run-progress.ts";

export type Recipe = Extract<WsServerEvent, { type: "recipe_saved" }>["recipe"];
type RepairEvent = Extract<WsServerEvent, { type: "repair_attempt" }>;
export type InstallRequest = Extract<WsServerEvent, { type: "install_required" }> & {
  progress?: { id: string; received: number; total: number; percent: number };
} | (Extract<WsServerEvent, { type: "composition_install_required" }> & {
  progress?: { id: string; received: number; total: number; percent: number };
});

export interface ActivityItem {
  runId?: string;
  message: string;
  kind: "activity" | "error";
}

export interface CheckItem {
  runId: string;
  name: string;
  status: "pending" | "passed" | "failed";
  expected?: string;
  actual?: string;
  stageIndex?: number;
  sourceId?: string;
}

export interface RunState {
  id?: string;
  status: "idle" | "running" | "complete" | "failed";
  action?: "task" | "recipe" | "composition";
  outputPath?: string;
  outputName?: string;
  modelCalls?: number;
  matchedRecipe?: string;
  matchScore?: number;
  savedRecipe?: Recipe;
  composition?: boolean;
}

export interface RunHistoryItem {
  runId: string;
  recipeName: string;
  action: "task" | "recipe" | "composition";
  files: string[];
  startedAt: number;
  completedAt: number;
  success: boolean;
  outputPath?: string;
  outputName?: string;
  composition?: boolean;
  modelCalls?: number;
  checks: CheckItem[];
}

interface ActiveRunHistory extends Omit<
  RunHistoryItem, "recipeName" | "completedAt" | "success"
> {
  recipeName?: string;
}

export const activity = writable<ActivityItem[]>([]);
export const checks = writable<CheckItem[]>([]);
export const recipes = writable<Recipe[]>([]);
export const composableCatalog = writable<ComposableCatalogEntry[]>([]);
export const compositions = writable<CompositionCommand[]>([]);
export const repairs = writable<RepairEvent[]>([]);
export const errors = writable<ActivityItem[]>([]);
export const installRequest = writable<InstallRequest | null>(null);
export const runState = writable<RunState>({ status: "idle" });
export const runHistory = writable<RunHistoryItem[]>([]);
export const selectedRecipeName = writable<string | undefined>();
export const runProgress = writable(createRunProgress());
export const compositionSubmissionPending = writable(false);
export interface CompositionStageProgress {
  stageIndex: number;
  sourceId: string;
  status: "running" | "verifying" | "passed" | "failed";
  commands: Array<{ index: number; status: "running" | "passed" | "failed"; durationMs?: number }>;
  checks: CheckItem[];
}
export const compositionStages = writable<CompositionStageProgress[]>([]);
export const savedCommands = derived(
  [recipes, compositions],
  ([$recipes, $compositions]): SavedCommand[] => [...$recipes, ...$compositions],
);
export const runClock = readable(Date.now(), (set) => {
  const timer = window.setInterval(() => set(Date.now()), 100);
  return () => window.clearInterval(timer);
});

export const killTotal = derived(recipes, ($recipes) => {
  const services = new Map<string, number>();
  for (const recipe of $recipes) {
    if (recipe.replaced_service && recipe.monthly_price !== undefined) {
      services.set(recipe.replaced_service, Math.round(recipe.monthly_price * 100));
    }
  }
  return [...services.values()].reduce((total, cents) => total + cents, 0) / 100;
});

function append(item: ActivityItem): void {
  activity.update((items) => [...items, item].slice(-500));
}

function upsertCheck(item: CheckItem): void {
  checks.update((items) => {
    const index = items.findIndex((candidate) =>
      candidate.runId === item.runId && candidate.name === item.name &&
      candidate.stageIndex === item.stageIndex && candidate.sourceId === item.sourceId
    );
    if (index < 0) return [...items, item];
    return items.map((candidate, current) => current === index ? item : candidate);
  });
}

function upsertRecipe(recipe: Recipe): void {
  recipes.update((items) => {
    const retained = items.filter((candidate) => candidate.name !== recipe.name);
    return [...retained, recipe];
  });
}

function updateCompositionStage(
  stageIndex: number, sourceId: string,
  update: (stage: CompositionStageProgress) => CompositionStageProgress,
): void {
  compositionStages.update((items) => {
    const index = items.findIndex((item) =>
      item.stageIndex === stageIndex && item.sourceId === sourceId
    );
    const stage = index < 0
      ? { stageIndex, sourceId, status: "running" as const, commands: [], checks: [] }
      : items[index]!;
    const next = update(stage);
    return index < 0
      ? [...items, next]
      : items.map((item, current) => current === index ? next : item);
  });
}

let activeRunHistory: ActiveRunHistory | undefined;
let pendingComposition:
  | { name: string; workflowIds: string[]; stages: CompositionStageView[]; inputName: string }
  | undefined;
let pendingCompositionInputName = "Selected local file";
let compositionRunEventsAccepted = true;

function recordCheck(item: CheckItem): void {
  if (!activeRunHistory || activeRunHistory.runId !== item.runId) return;
  const index = activeRunHistory.checks.findIndex((candidate) =>
    candidate.name === item.name && candidate.stageIndex === item.stageIndex &&
    candidate.sourceId === item.sourceId
  );
  if (index < 0) activeRunHistory.checks.push(item);
  else activeRunHistory.checks[index] = item;
}

export function rememberCompositionInputName(name: string): void {
  pendingCompositionInputName = name.trim() || "Selected local file";
}

export function applyClientEvent(event: WsClientEvent): void {
  runProgress.update((state) => reduceClientEvent(state, event));
  if (event.type === "run_composition") {
    compositionSubmissionPending.set(true);
    pendingComposition = {
      name: event.name,
      workflowIds: [...event.workflow_ids],
      stages: selectedStageSnapshots(
        event.workflow_ids, get(recipes), get(compositions), get(composableCatalog),
      ),
      inputName: pendingCompositionInputName,
    };
  } else if (event.type === "run_saved_workflow" && "staged_input_id" in event) {
    compositionSubmissionPending.set(true);
    const saved = get(compositions).find((item) => item.name === event.workflow_id);
    pendingComposition = {
      name: event.workflow_id, workflowIds: [event.workflow_id],
      stages: saved?.stages.map((stage) => structuredClone(stage)) ?? [],
      inputName: pendingCompositionInputName,
    };
  }
}

function runIdFor(event: WsServerEvent): string | undefined {
  return "run_id" in event ? event.run_id : undefined;
}

function startsRun(event: WsServerEvent): boolean {
  return event.type === "run_started" || event.type === "composition_run_started";
}

function isCompositionRunEvent(event: WsServerEvent): boolean {
  return "run_id" in event && event.type.startsWith("composition_");
}

export function applyServerEvent(event: WsServerEvent, receivedAt = Date.now()): void {
  if (!compositionRunEventsAccepted && isCompositionRunEvent(event)) return;
  const eventRunId = runIdFor(event);
  if (eventRunId !== undefined && !startsRun(event) &&
      get(runState).id !== eventRunId) {
    return;
  }
  runProgress.update((state) => reduceServerEvent(state, event, receivedAt));
  switch (event.type) {
    case "workflow_catalog":
      recipes.set(event.workflows);
      return;
    case "composable_catalog":
      composableCatalog.set(event.workflows);
      compositions.update((items) => event.workflows
        .filter((entry) => entry.kind === "composition")
        .map((entry) => {
          const existing = items.find((item) =>
            item.name === entry.workflow_id
          );
          const detailMatches = existing?.detail !== undefined &&
            existing.detail.stage_count === entry.stage_count &&
            existing.detail.command_count === entry.command_count &&
            (!entry.eligible ||
              JSON.stringify(existing.detail.contract) === JSON.stringify(entry.contract));
          if (detailMatches) return existing;
          return compositionSummary(
            entry.workflow_id, entry.stage_count,
            entry.eligible ? entry.contract : undefined,
          );
        }));
      return;
    case "composition_detail":
      compositions.update((items) => {
        const existing = items.find((item) => item.name === event.detail.workflow_id);
        const hydrated = compositionFromDetail(event.detail, existing?.stages ?? []);
        return [
          ...items.filter((item) => item.name !== hydrated.name),
          hydrated,
        ];
      });
      return;
    case "run_started":
      activity.set([]);
      checks.set([]);
      repairs.set([]);
      installRequest.set(null);
      runState.set({ id: event.run_id, status: "running", action: event.action });
      activeRunHistory = {
        runId: event.run_id, action: event.action, files: [...event.files],
        startedAt: receivedAt, checks: [],
      };
      return;
    case "composition_run_started":
      compositionSubmissionPending.set(false);
      activity.set([]);
      checks.set([]);
      compositionStages.set([]);
      installRequest.set(null);
      runState.set({
        id: event.run_id, status: "running", action: "composition",
        matchedRecipe: event.workflow_id, composition: true,
      });
      activeRunHistory = {
        runId: event.run_id, action: "composition",
        files: [pendingComposition?.inputName ?? "Selected local file"],
        startedAt: receivedAt, checks: [], recipeName: event.workflow_id,
        composition: true,
      };
      return;
    case "activity":
      append({ runId: event.run_id, message: event.message, kind: "activity" });
      return;
    case "model_call_count":
      if (activeRunHistory?.runId === event.run_id) {
        activeRunHistory.modelCalls = event.model_calls;
      }
      runState.update((state) => state.id === event.run_id
        ? { ...state, modelCalls: event.model_calls }
        : state);
      return;
    case "command_started":
    case "command_completed":
    case "verification_started":
    case "verification_completed":
      return;
    case "composition_selected":
      if (activeRunHistory?.runId === event.run_id) {
        activeRunHistory.recipeName = event.workflow_id;
        activeRunHistory.modelCalls = event.model_calls;
      }
      runState.update((state) => state.id === event.run_id
        ? {
          ...state, matchedRecipe: event.workflow_id,
          modelCalls: event.model_calls, composition: true,
        }
        : state);
      return;
    case "composition_stage_started":
      if (pendingComposition && !pendingComposition.stages.some((stage) =>
        stage.stage_index === event.stage_index && stage.source_id === event.source_id
      )) {
        const [snapshot] = selectedStageSnapshots(
          [event.source_id], get(recipes), get(compositions), get(composableCatalog),
        );
        if (snapshot) {
          pendingComposition.stages.push({
            ...snapshot, stage_index: event.stage_index,
          });
          pendingComposition.stages.sort((left, right) =>
            left.stage_index - right.stage_index
          );
        }
      }
      updateCompositionStage(event.stage_index, event.source_id, (stage) => ({
        ...stage, status: "running",
      }));
      append({
        runId: event.run_id,
        message: `Stage ${event.stage_index + 1}: ${event.source_id.replaceAll("-", " ")}.`,
        kind: "activity",
      });
      return;
    case "composition_command_started": {
      const command: CompositionStageProgress["commands"][number] = {
        index: event.command_index,
        status: "running",
      };
      updateCompositionStage(event.stage_index, event.source_id, (stage) => ({
        ...stage,
        commands: [
          ...stage.commands.filter((command) => command.index !== event.command_index),
          command,
        ].sort((left, right) => left.index - right.index),
      }));
      return;
    }
    case "composition_command_completed":
      updateCompositionStage(event.stage_index, event.source_id, (stage) => ({
        ...stage,
        status: event.exit_code === 0 ? stage.status : "failed",
        commands: stage.commands.map((command) => command.index === event.command_index
          ? {
            ...command, status: event.exit_code === 0 ? "passed" : "failed",
            durationMs: event.duration_ms,
          }
          : command),
      }));
      return;
    case "composition_verification_started":
      updateCompositionStage(event.stage_index, event.source_id, (stage) => ({
        ...stage, status: "verifying",
      }));
      return;
    case "composition_verification_completed":
      return;
    case "install_required":
      installRequest.set(event);
      append({
        runId: event.run_id,
        message: "Confirmation required before installing the declared model or tool.",
        kind: "activity",
      });
      return;
    case "composition_install_required":
      installRequest.set(event);
      append({
        runId: event.run_id,
        message: "One confirmation is required for all missing local tools and resources.",
        kind: "activity",
      });
      return;
    case "install_progress":
      installRequest.update((request) => request?.run_id === event.run_id
        ? { ...request, progress: event }
        : request);
      return;
    case "composition_install_progress":
      installRequest.update((request) => request?.run_id === event.run_id
        ? { ...request, progress: event }
        : request);
      return;
    case "install_complete":
      installRequest.set(null);
      append({ runId: event.run_id, message: event.message, kind: "activity" });
      return;
    case "composition_install_complete":
      installRequest.set(null);
      append({ runId: event.run_id, message: event.message, kind: "activity" });
      return;
    case "composition_install_denied":
      installRequest.set(null);
      append({
        runId: event.run_id, message: "Installation was declined. Nothing was run or saved.",
        kind: "activity",
      });
      return;
    case "check_pending":
      upsertCheck({ runId: event.run_id, name: event.name, status: "pending" });
      return;
    case "composition_check_pending": {
      const item: CheckItem = {
        runId: event.run_id, name: event.name, status: "pending",
        stageIndex: event.stage_index, sourceId: event.source_id,
      };
      upsertCheck(item);
      updateCompositionStage(event.stage_index, event.source_id, (stage) => ({
        ...stage,
        checks: [...stage.checks.filter((check) => check.name !== item.name), item],
      }));
      return;
    }
    case "check_result":
      {
        const item: CheckItem = {
          runId: event.run_id, name: event.name,
          status: event.pass ? "passed" : "failed",
          expected: event.expected, actual: event.actual,
        };
        upsertCheck(item);
        recordCheck(item);
      }
      return;
    case "composition_check_result": {
      const item: CheckItem = {
        runId: event.run_id, name: event.name,
        status: event.pass ? "passed" : "failed",
        expected: event.expected, actual: event.actual,
        stageIndex: event.stage_index, sourceId: event.source_id,
      };
      upsertCheck(item);
      recordCheck(item);
      updateCompositionStage(event.stage_index, event.source_id, (stage) => ({
        ...stage,
        status: event.pass && stage.checks.every((check) =>
          check.name === item.name || check.status === "passed"
        ) ? "passed" : event.pass ? stage.status : "failed",
        checks: [...stage.checks.filter((check) => check.name !== item.name), item],
      }));
      return;
    }
    case "repair_attempt":
      repairs.update((items) => [...items, event]);
      append({
        runId: event.run_id,
        message: `Repair attempt ${event.attempt} started.`,
        kind: "activity",
      });
      return;
    case "recipe_saved":
      upsertRecipe(event.recipe);
      if (activeRunHistory?.runId === event.run_id) {
        activeRunHistory.recipeName = event.recipe.name;
      }
      runState.update((state) => state.id === event.run_id
        ? { ...state, savedRecipe: event.recipe }
        : state);
      append({
        runId: event.run_id,
        message: "Workflow saved. Future runs use zero model calls.",
        kind: "activity",
      });
      return;
    case "composition_saved": {
      const stages = pendingComposition?.name === event.workflow.workflow_id
        ? pendingComposition.stages : [];
      const saved = savedComposition(event.workflow, stages);
      compositions.update((items) => [
        ...items.filter((item) => item.name !== saved.name), saved,
      ]);
      if (activeRunHistory?.runId === event.run_id) {
        activeRunHistory.recipeName = saved.name;
      }
      runState.update((state) => state.id === event.run_id
        ? { ...state, matchedRecipe: saved.name, composition: true }
        : state);
      return;
    }
    case "recipe_matched":
      if (activeRunHistory?.runId === event.run_id) {
        activeRunHistory.recipeName = event.name;
        activeRunHistory.modelCalls = event.model_calls;
      }
      runState.update((state) => ({
        ...state, modelCalls: event.model_calls,
        matchedRecipe: event.name, matchScore: event.score,
      }));
      append({
        runId: event.run_id,
        message: `Saved workflow matched. ${event.model_calls} model calls.`,
        kind: "activity",
      });
      return;
    case "workflow_selected":
      if (activeRunHistory?.runId === event.run_id) {
        activeRunHistory.recipeName = event.workflow_id;
        activeRunHistory.modelCalls = event.model_calls;
      }
      runState.update((state) => ({
        ...state,
        modelCalls: event.model_calls,
        matchedRecipe: event.workflow_id,
        matchScore: 1,
      }));
      append({
        runId: event.run_id,
        message: `Saved workflow selected directly. ${event.model_calls} model calls.`,
        kind: "activity",
      });
      return;
    case "run_complete":
      installRequest.set(null);
      if (activeRunHistory?.runId === event.run_id) {
        const active = activeRunHistory;
        const recipeName = active.recipeName;
        if (recipeName) {
          const modelCalls = event.model_calls ?? active.modelCalls;
          runHistory.update((items) => [...items, {
            ...active,
            recipeName,
            completedAt: receivedAt,
            success: event.success,
            outputPath: event.output_path,
            ...(modelCalls === undefined ? {} : { modelCalls }),
            checks: active.checks.map((check) => ({ ...check })),
          }].slice(-100));
        }
        activeRunHistory = undefined;
      }
      runState.update((state) => ({
        ...state, status: event.success ? "complete" : "failed",
        outputPath: event.output_path,
        modelCalls: event.model_calls ?? state.modelCalls,
      }));
      return;
    case "composition_cleanup":
      append({
        runId: event.run_id,
        message: event.success
          ? "Managed intermediate files were cleaned."
          : `Cleanup needs attention: ${(event.failed_actions ?? []).join(", ")}.`,
        kind: event.success ? "activity" : "error",
      });
      return;
    case "composition_run_complete":
      installRequest.set(null);
      if (activeRunHistory?.runId === event.run_id) {
        const active = activeRunHistory;
        const recipeName = active.recipeName;
        if (recipeName) {
          runHistory.update((items) => [...items, {
            ...active,
            recipeName,
            completedAt: receivedAt,
            success: event.success,
            outputName: event.output_name,
            modelCalls: event.model_calls,
            checks: active.checks.map((check) => ({ ...check })),
          }].slice(-100));
        }
        activeRunHistory = undefined;
      }
      compositionStages.update((items) => items.map((stage) =>
        event.success ? { ...stage, status: "passed" } :
          stage.status === "running" || stage.status === "verifying"
            ? { ...stage, status: "failed" } : stage
      ));
      runState.update((state) => state.id === event.run_id
        ? {
          ...state, status: event.success ? "complete" : "failed",
          outputName: event.output_name, modelCalls: event.model_calls, composition: true,
        }
        : state);
      const completedComposition = pendingComposition;
      if (event.success && completedComposition?.stages.length) {
        compositions.update((items) => items.map((item) => {
          if (item.name !== completedComposition.name ||
              item.stage_count !== completedComposition.stages.length) return item;
          const detailed = {
            ...item,
            stages: completedComposition.stages.map((stage) => structuredClone(stage)),
          };
          return detailed;
        }));
      }
      pendingComposition = undefined;
      compositionSubmissionPending.set(false);
      return;
    case "composition_error": {
      installRequest.set(null);
      const item = { runId: event.run_id, message: event.message, kind: "error" as const };
      errors.update((items) => [...items, item].slice(-50));
      append(item);
      runState.update((state) => state.id === event.run_id
        ? { ...state, status: "failed", composition: true }
        : state);
      return;
    }
    case "error": {
      if (event.run_id) installRequest.set(null);
      const item = { runId: event.run_id, message: event.message, kind: "error" as const };
      errors.update((items) => [...items, item].slice(-50));
      append(item);
      if (event.run_id) {
        runState.update((state) => state.id === event.run_id
          ? { ...state, status: "failed" }
          : state);
      }
      return;
    }
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

export function handleConnectionClosed(
  message = "Connection to Steward closed. The active run was stopped.",
): void {
  compositionRunEventsAccepted = false;
  const awaitingCompositionStart = get(compositionSubmissionPending);
  compositionSubmissionPending.set(false);
  installRequest.set(null);
  compositionStages.set([]);
  pendingComposition = undefined;
  pendingCompositionInputName = "Selected local file";
  activeRunHistory = undefined;
  const active = get(runState);
  if (active.status !== "running") {
    if (awaitingCompositionStart) {
      const item: ActivityItem = { message, kind: "error" };
      errors.update((items) => [...items, item].slice(-50));
      append(item);
      runProgress.update((state) => reduceServerEvent(
        state, { type: "error", message }, Date.now(),
      ));
    }
    return;
  }
  const item: ActivityItem = { runId: active.id, message, kind: "error" };
  errors.update((items) => [...items, item].slice(-50));
  append(item);
  const { id: _revokedRunId, ...revoked } = active;
  runState.set({ ...revoked, status: "failed" });
  runProgress.update((state) => reduceServerEvent(
    state, { type: "error", message }, Date.now(),
  ));
}

export function handleConnectionOpened(): void {
  compositionRunEventsAccepted = true;
}

export function resetStores(): void {
  activity.set([]);
  checks.set([]);
  recipes.set([]);
  composableCatalog.set([]);
  compositions.set([]);
  compositionStages.set([]);
  repairs.set([]);
  errors.set([]);
  installRequest.set(null);
  runState.set({ status: "idle" });
  runHistory.set([]);
  selectedRecipeName.set(undefined);
  runProgress.set(createRunProgress());
  compositionSubmissionPending.set(false);
  activeRunHistory = undefined;
  pendingComposition = undefined;
  pendingCompositionInputName = "Selected local file";
  compositionRunEventsAccepted = true;
}
