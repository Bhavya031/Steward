import {
  compositionRequirementMetadata, installCompositionRequirements,
  type CompositionRequirements,
} from "./composition-installation.ts";
import type { EmitWsEvent } from "./ws-events.ts";
import type { FrozenCompositionRun } from "./ws-composition-run.ts";

export interface PendingCompositionInstall extends FrozenCompositionRun {
  requirements: CompositionRequirements;
}

export type CompositionInstaller = typeof installCompositionRequirements;

export function pauseCompositionInstall(
  runId: string,
  pending: PendingCompositionInstall,
  emit: EmitWsEvent,
  pendingRuns: Map<string, PendingCompositionInstall>,
): void {
  pendingRuns.set(runId, pending);
  const metadata = compositionRequirementMetadata(pending.requirements);
  emit({
    type: "composition_install_required", run_id: runId,
    tools: metadata.tools, resources: metadata.resources,
  });
}

export async function resumeCompositionInstall(
  runId: string,
  pendingRuns: Map<string, PendingCompositionInstall>,
  emit: EmitWsEvent,
  install: CompositionInstaller = installCompositionRequirements,
): Promise<FrozenCompositionRun> {
  const pending = pendingRuns.get(runId);
  if (!pending) throw new Error("composition installation approval is unknown or expired");
  pending.session.assertActive();
  const lastPercent = new Map<string, number>();
  try {
    const profile = await install(pending.profile, pending.requirements, {
      signal: pending.session.signal,
      onResourceProgress: ({ id, received, total }) => {
        const percent = Math.min(100, Math.floor(received / total * 100));
        if (lastPercent.get(id) === percent) return;
        lastPercent.set(id, percent);
        emit({
          type: "composition_install_progress", run_id: runId,
          id, received, total, percent,
        });
      },
    });
    pending.session.assertActive();
    pendingRuns.delete(runId);
    emit({
      type: "composition_install_complete", run_id: runId,
      message: "Installation verified. Continuing the frozen composition.",
    });
    return {
      composition_json: pending.composition_json,
      session: pending.session,
      directory: pending.directory,
      persist_on_success: pending.persist_on_success,
      profile,
    };
  } catch (error) {
    pendingRuns.delete(runId);
    throw error;
  }
}

export function denyCompositionInstall(
  runId: string,
  pendingRuns: Map<string, PendingCompositionInstall>,
  emit: EmitWsEvent,
): void {
  const pending = pendingRuns.get(runId);
  if (!pending || !pendingRuns.delete(runId)) {
    throw new Error("composition installation approval is unknown or expired");
  }
  pending.session.finalizeInput();
  emit({ type: "composition_install_denied", run_id: runId });
  emit({
    type: "composition_run_complete", run_id: runId,
    success: false, model_calls: 0,
  });
}
