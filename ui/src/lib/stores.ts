import { derived, writable } from "svelte/store";
import type { ServerEvent } from "../../../server/ws-events.ts";

type Recipe = Extract<ServerEvent, { type: "recipe_saved" }>["recipe"];
type RepairEvent = Extract<ServerEvent, { type: "repair_attempt" }>;

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
  modelCalls?: 0;
  matchedRecipe?: string;
  matchScore?: number;
}

export const activity = writable<ActivityItem[]>([]);
export const checks = writable<CheckItem[]>([]);
export const recipes = writable<Recipe[]>([]);
export const repairs = writable<RepairEvent[]>([]);
export const errors = writable<ActivityItem[]>([]);
export const runState = writable<RunState>({ status: "idle" });

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

export function applyServerEvent(event: ServerEvent): void {
  switch (event.type) {
    case "run_started":
      activity.set([]);
      checks.set([]);
      repairs.set([]);
      runState.set({ id: event.run_id, status: "running", action: event.action });
      return;
    case "activity":
      append({ runId: event.run_id, message: event.message, kind: "activity" });
      return;
    case "check_pending":
      upsertCheck({ runId: event.run_id, name: event.name, status: "pending" });
      return;
    case "check_result":
      upsertCheck({
        runId: event.run_id, name: event.name,
        status: event.pass ? "passed" : "failed",
        expected: event.expected, actual: event.actual,
      });
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
      append({
        runId: event.run_id,
        message: "Recipe saved. Future runs use zero model calls.",
        kind: "activity",
      });
      return;
    case "recipe_matched":
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
  runState.set({ status: "idle" });
}
