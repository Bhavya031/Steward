import { randomUUID } from "node:crypto";
import {
  compositionRequirementsNeeded,
} from "./composition-installation.ts";
import { composableCatalog } from "./composition-catalog.ts";
import { authoritativeCompositionDetail } from "./composition-detail.ts";
import { CompositionSession } from "./composition-session.ts";
import { probeSystem } from "./probe.ts";
import { RECIPES_DIRECTORY } from "./recipes.ts";
import type { CompositionClientEvent } from "./ws-composition-events.ts";
import {
  denyCompositionInstall, pauseCompositionInstall, resumeCompositionInstall,
  type PendingCompositionInstall,
} from "./ws-composition-install.ts";
import {
  executeFrozenComposition,
} from "./ws-composition-run.ts";
import { publicCompositionError } from "./ws-composition-run-events.ts";
import {
  authoritativeComposition, compositionServices, type WsCompositionOptions,
} from "./ws-composition-services.ts";
import type { EmitWsEvent, WsClientEvent } from "./ws-events.ts";

export type { WsCompositionOptions } from "./ws-composition-services.ts";

function fail(runId: string, error: unknown, emit: EmitWsEvent): void {
  emit({
    type: "composition_error", run_id: runId,
    message: publicCompositionError(error, "composition request failed safely"),
  });
  emit({
    type: "composition_run_complete", run_id: runId,
    success: false, model_calls: 0,
  });
}

async function start(
  request: Extract<CompositionClientEvent, { type: "run_composition" | "run_saved_workflow" }>,
  emit: EmitWsEvent,
  options: WsCompositionOptions,
): Promise<void> {
  const runId = randomUUID();
  const session = new CompositionSession(runId);
  const sessions = options.compositionSessions;
  sessions?.set(runId, session);
  const sessionEmit: EmitWsEvent = (event) => session.emit(emit, event);
  const workflowId = request.type === "run_composition" ? request.name : request.workflow_id;
  sessionEmit({
    type: "composition_run_started", run_id: runId,
    action: request.type === "run_composition" ? "create" : "recipe", workflow_id: workflowId,
  });
  sessionEmit({ type: "model_call_count", run_id: runId, model_calls: 0 });
  try {
    const directory = options.recipeDirectory ?? RECIPES_DIRECTORY;
    const profile = options.profile ?? probeSystem();
    const resolved = compositionServices(options);
    const selected = authoritativeComposition(request, directory, profile, resolved.build);
    if (request.type === "run_saved_workflow") {
      sessionEmit({
        type: "composition_selected", run_id: runId,
        workflow_id: selected.recipe.name, model_calls: 0,
      });
    }
    if (!options.stagedInputs) throw new Error("server-staged input registry is unavailable");
    session.attachInput(options.stagedInputs.claim(request.staged_input_id));
    session.assertActive();
    const requirements = await resolved.requirements(selected.recipe, profile);
    session.assertActive();
    const frozen = {
      composition_json: JSON.stringify(selected.recipe),
      session, profile, directory,
      persist_on_success: selected.persist,
    };
    if (compositionRequirementsNeeded(requirements)) {
      pauseCompositionInstall(
        runId, { ...frozen, requirements }, sessionEmit,
        options.pendingCompositionRuns ?? new Map(),
      );
      return;
    }
    await executeFrozenComposition(runId, frozen, emit, resolved.run, sessions);
  } catch (error) {
    let failure = error;
    try {
      session.finalizeInput(error);
    } catch (finalized) {
      failure = finalized;
    }
    fail(runId, failure, sessionEmit);
    session.settle();
    if (session.inputCleanupComplete) sessions?.delete(runId);
  }
}

export function handlesCompositionEvent(
  request: WsClientEvent,
  pending: Map<string, PendingCompositionInstall>,
): boolean {
  return request.type === "get_composable_catalog" ||
    request.type === "get_composition_detail" ||
    request.type === "run_composition" || request.type === "deny_install" ||
    request.type === "run_saved_workflow" && "staged_input_id" in request ||
    request.type === "confirm_install" && pending.has(request.run_id);
}

export async function runCompositionProtocolEvent(
  request: WsClientEvent,
  emit: EmitWsEvent,
  options: WsCompositionOptions,
): Promise<void> {
  const pending = options.pendingCompositionRuns ?? new Map();
  if (request.type === "get_composable_catalog") {
    emit({
      type: "composable_catalog",
      workflows: composableCatalog(options.recipeDirectory ?? RECIPES_DIRECTORY),
    });
  } else if (request.type === "get_composition_detail") {
    emit({
      type: "composition_detail",
      detail: authoritativeCompositionDetail(
        request.workflow_id,
        options.recipeDirectory ?? RECIPES_DIRECTORY,
      ),
    });
  } else if (request.type === "deny_install") {
    const session = pending.get(request.run_id)?.session;
    const sessionEmit: EmitWsEvent = (event) =>
      session ? session.emit(emit, event) : emit(event);
    try {
      denyCompositionInstall(request.run_id, pending, sessionEmit);
    } catch (error) {
      fail(request.run_id, error, sessionEmit);
    } finally {
      session?.settle();
      if (session?.inputCleanupComplete) {
        options.compositionSessions?.delete(request.run_id);
      }
    }
  } else if (request.type === "confirm_install") {
    const session = pending.get(request.run_id)?.session;
    const sessionEmit: EmitWsEvent = (event) =>
      session ? session.emit(emit, event) : emit(event);
    try {
      const frozen = await resumeCompositionInstall(
        request.run_id, pending, sessionEmit, compositionServices(options).install,
      );
      await executeFrozenComposition(
        request.run_id, frozen, sessionEmit, compositionServices(options).run,
        options.compositionSessions,
      );
    } catch (error) {
      let failure = error;
      if (session) {
        try {
          session.finalizeInput(error);
        } catch (finalized) {
          failure = finalized;
        }
      }
      fail(request.run_id, failure, sessionEmit);
      session?.settle();
      if (session?.inputCleanupComplete) {
        options.compositionSessions?.delete(request.run_id);
      }
    }
  } else if (request.type === "run_composition" ||
             request.type === "run_saved_workflow" && "staged_input_id" in request) {
    await start(request, emit, { ...options, pendingCompositionRuns: pending });
  }
}
