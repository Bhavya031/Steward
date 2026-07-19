import { basename } from "node:path";
import { composableCatalog } from "./composition-catalog.ts";
import {
  CompositionCleanupError, CompositionRunFailureError,
} from "./composition-cleanup.ts";
import { runComposition } from "./composition-runtime.ts";
import type { CompositionSession } from "./composition-session.ts";
import { persistRecipe } from "./recipe-persistence.ts";
import type { CompositionRecipe } from "./recipe-types.ts";
import { isAtomicRecipe, validateSavedRecipe } from "./recipe-validation.ts";
import type { SystemProfile } from "./probe.ts";
import {
  compositionRuntimeEvents, publicCompositionError,
} from "./ws-composition-run-events.ts";
import type { EmitWsEvent } from "./ws-events.ts";

export interface FrozenCompositionRun {
  composition_json: string;
  session: CompositionSession;
  profile: SystemProfile;
  directory: string;
  persist_on_success: boolean;
}

export interface CompositionRunServices {
  run: typeof runComposition;
  persist: typeof persistRecipe;
  catalog: typeof composableCatalog;
}

export const DEFAULT_COMPOSITION_RUN_SERVICES: CompositionRunServices = {
  run: runComposition,
  persist: persistRecipe,
  catalog: composableCatalog,
};

function frozenRecipe(json: string): CompositionRecipe {
  const saved = validateSavedRecipe(JSON.parse(json));
  if (isAtomicRecipe(saved)) throw new Error("frozen workflow is not a composition");
  return saved;
}

function failed(
  runId: string,
  message: string,
  emit: EmitWsEvent,
): void {
  emit({ type: "composition_error", run_id: runId, message });
  emit({
    type: "composition_run_complete", run_id: runId,
    success: false, model_calls: 0,
  });
}

export async function executeFrozenComposition(
  runId: string,
  pending: FrozenCompositionRun,
  emit: EmitWsEvent,
  services: CompositionRunServices = DEFAULT_COMPOSITION_RUN_SERVICES,
  sessions?: Map<string, CompositionSession>,
): Promise<void> {
  let runtimeEntered = false;
  let inputFinalized = false;
  const sessionEmit: EmitWsEvent = (event) => pending.session.emit(emit, event);
  try {
    const composition = frozenRecipe(pending.composition_json);
    pending.session.assertActive();
    const inputPath = pending.session.inputPath();
    runtimeEntered = true;
    const run = await services.run(composition, inputPath, {
      profile: pending.profile,
      executionOptions: { signal: pending.session.signal },
      onEvent: compositionRuntimeEvents(runId, sessionEmit),
    });
    if (!run.success) {
      inputFinalized = true;
      const failure = new CompositionRunFailureError(run);
      pending.session.finalizeInput(failure);
      throw failure;
    }
    if (typeof run.output_path !== "string" || run.output_path.length === 0) {
      throw new Error("successful composition runtime returned no output path");
    }
    const outputPath = run.output_path;
    pending.session.assertActive();
    inputFinalized = true;
    pending.session.finalizeInput();
    pending.session.assertActive();
    sessionEmit({ type: "composition_cleanup", run_id: runId, success: true });
    if (pending.persist_on_success) {
      pending.session.assertActive();
      services.persist(composition, pending.directory);
      sessionEmit({
        type: "composition_saved", run_id: runId,
        workflow: {
          workflow_id: composition.name,
          created_at: composition.created_at,
          stage_count: composition.stages.length,
          contract: composition.composition_contract,
        },
      });
      sessionEmit({
        type: "composable_catalog",
        workflows: services.catalog(pending.directory),
      });
    }
    sessionEmit({
      type: "composition_run_complete", run_id: runId, success: true,
      output_name: basename(outputPath), model_calls: 0,
    });
  } catch (error) {
    let failure = error;
    if (!inputFinalized) {
      inputFinalized = true;
      try {
        pending.session.finalizeInput(error);
      } catch (finalized) {
        failure = finalized;
      }
    }
    if (runtimeEntered) {
      const cleanupErrors = failure instanceof CompositionCleanupError
        ? failure.cleanupErrors : [];
      sessionEmit(cleanupErrors.length
        ? {
          type: "composition_cleanup", run_id: runId, success: false,
          failed_actions: cleanupErrors.map(({ action }) => action),
        }
        : { type: "composition_cleanup", run_id: runId, success: true });
    }
    failed(
      runId,
      publicCompositionError(failure, "composition execution failed safely"),
      sessionEmit,
    );
  } finally {
    pending.session.settle();
    if (pending.session.inputCleanupComplete) sessions?.delete(runId);
  }
}
