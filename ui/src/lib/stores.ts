import { derived, readable, writable } from "svelte/store";
import type { ClientEvent, ServerEvent } from "../../../server/ws-events.ts";
import {
  createRunProgress, reduceClientEvent, reduceServerEvent,
} from "./run-progress.ts";

export type Recipe = Extract<ServerEvent, { type: "recipe_saved" }>["recipe"];
type RepairEvent = Extract<ServerEvent, { type: "repair_attempt" }>;
export type InstallRequest = Extract<ServerEvent, { type: "install_required" }> & {
  progress?: { id: string; received: number; total: number; percent: number };
};

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
}

export interface RunState {
  id?: string;
  status: "idle" | "running" | "complete" | "failed";
  action?: "task" | "recipe";
  outputPath?: string;
  modelCalls?: number;
  matchedRecipe?: string;
  matchScore?: number;
  savedRecipe?: Recipe;
}

export interface RunHistoryItem {
  runId: string;
  recipeName: string;
  action: "task" | "recipe";
  files: string[];
  startedAt: number;
  completedAt: number;
  success: boolean;
  outputPath?: string;
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
export const repairs = writable<RepairEvent[]>([]);
export const errors = writable<ActivityItem[]>([]);
export const installRequest = writable<InstallRequest | null>(null);
export const runState = writable<RunState>({ status: "idle" });
export const runHistory = writable<RunHistoryItem[]>([]);
export const selectedRecipeName = writable<string | undefined>();
export const runProgress = writable(createRunProgress());
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
      candidate.runId === item.runId && candidate.name === item.name
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

let activeRunHistory: ActiveRunHistory | undefined;

function recordCheck(item: CheckItem): void {
  if (!activeRunHistory || activeRunHistory.runId !== item.runId) return;
  const index = activeRunHistory.checks.findIndex(({ name }) => name === item.name);
  if (index < 0) activeRunHistory.checks.push(item);
  else activeRunHistory.checks[index] = item;
}

export function applyClientEvent(event: ClientEvent): void {
  runProgress.update((state) => reduceClientEvent(state, event));
}

export function applyServerEvent(event: ServerEvent, receivedAt = Date.now()): void {
  runProgress.update((state) => reduceServerEvent(state, event, receivedAt));
  switch (event.type) {
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
    case "install_required":
      installRequest.set(event);
      append({
        runId: event.run_id,
        message: "Confirmation required before installing the declared model or tool.",
        kind: "activity",
      });
      return;
    case "install_progress":
      installRequest.update((request) => request?.run_id === event.run_id
        ? { ...request, progress: event }
        : request);
      return;
    case "install_complete":
      installRequest.set(null);
      append({ runId: event.run_id, message: event.message, kind: "activity" });
      return;
    case "check_pending":
      upsertCheck({ runId: event.run_id, name: event.name, status: "pending" });
      return;
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
        message: "Recipe saved. Future runs use zero model calls.",
        kind: "activity",
      });
      return;
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
        message: "Saved recipe matched. 0 model calls.",
        kind: "activity",
      });
      return;
    case "run_complete":
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
    case "error": {
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

export function resetStores(): void {
  activity.set([]);
  checks.set([]);
  recipes.set([]);
  repairs.set([]);
  errors.set([]);
  installRequest.set(null);
  runState.set({ status: "idle" });
  runHistory.set([]);
  selectedRecipeName.set(undefined);
  runProgress.set(createRunProgress());
  activeRunHistory = undefined;
}
