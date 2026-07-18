import {
  installRequirements, requirementMetadata, type PlanRequirements,
} from "./installation-runtime.ts";
import type { Plan } from "./plan.ts";
import type { SystemProfile } from "./probe.ts";
import type { Recipe } from "./recipes.ts";
import type { EmitServerEvent } from "./ws-events.ts";
import { executionEvents } from "./ws-run-events.ts";

interface PendingBase {
  files: string[];
  profile: SystemProfile;
  plan: Plan;
  requirements: PlanRequirements;
}
export interface PlannedPending extends PendingBase {
  kind: "planned";
  directory: string;
  taskDescription: string;
  modelCalls: number;
}
export interface SavedPending extends PendingBase {
  kind: "saved";
  recipe: Recipe;
  score: number;
}
export type PendingInstall = PlannedPending | SavedPending;

export function requirementsNeeded(requirements: PlanRequirements): boolean {
  return requirements.command !== null || requirements.resources.length > 0;
}

export function pauseForInstall(
  runId: string,
  pending: PendingInstall,
  emit: EmitServerEvent,
  pendingRuns: Map<string, PendingInstall>,
): null {
  pendingRuns.set(runId, pending);
  emit({
    type: "install_required",
    run_id: runId,
    tool: pending.requirements.tool,
    command: pending.requirements.command,
    resources: requirementMetadata(pending.requirements),
  });
  return null;
}

export async function resumeInstall(
  runId: string,
  pendingRuns: Map<string, PendingInstall>,
  emit: EmitServerEvent,
): Promise<{ pending: PendingInstall; plan: Plan; profile: SystemProfile }> {
  const pending = pendingRuns.get(runId);
  if (!pending) throw new Error("installation confirmation is unknown or expired");
  emit({
    type: "activity", run_id: runId,
    message: "Confirmed. Installing the declared local requirements.",
  });
  let lastPercent = -1;
  const ready = await installRequirements(pending.plan, pending.profile, pending.requirements, {
    onToolEvent: executionEvents(runId, emit),
    onResourceProgress: ({ id, received, total }) => {
      const percent = Math.min(100, Math.floor(received / total * 100));
      if (percent === lastPercent) return;
      lastPercent = percent;
      emit({ type: "install_progress", run_id: runId, id, received, total, percent });
    },
  });
  emit({
    type: "install_complete", run_id: runId,
    message: "Installation verified. Continuing automatically.",
  });
  pendingRuns.delete(runId);
  return { pending, ...ready };
}
