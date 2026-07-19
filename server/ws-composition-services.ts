import { buildComposition } from "./composition-builder.ts";
import type { CompositionSession } from "./composition-session.ts";
import {
  compositionRequirements, installCompositionRequirements,
} from "./composition-installation.ts";
import type { SystemProfile } from "./probe.ts";
import type { CompositionRecipe } from "./recipe-types.ts";
import { isAtomicRecipe } from "./recipe-validation.ts";
import { loadSaved } from "./recipes.ts";
import type { StagedInputRegistry } from "./staged-input-registry.ts";
import type { CompositionClientEvent } from "./ws-composition-events.ts";
import type {
  CompositionInstaller, PendingCompositionInstall,
} from "./ws-composition-install.ts";
import {
  DEFAULT_COMPOSITION_RUN_SERVICES, type CompositionRunServices,
} from "./ws-composition-run.ts";

export interface CompositionProtocolServices {
  build: typeof buildComposition;
  requirements: typeof compositionRequirements;
  install: CompositionInstaller;
  run: CompositionRunServices;
}

const DEFAULT_SERVICES: CompositionProtocolServices = {
  build: buildComposition,
  requirements: compositionRequirements,
  install: installCompositionRequirements,
  run: DEFAULT_COMPOSITION_RUN_SERVICES,
};

export interface WsCompositionOptions {
  recipeDirectory?: string;
  profile?: SystemProfile;
  stagedInputs?: StagedInputRegistry;
  pendingCompositionRuns?: Map<string, PendingCompositionInstall>;
  compositionSessions?: Map<string, CompositionSession>;
  compositionServices?: Partial<Omit<CompositionProtocolServices, "run">> & {
    run?: Partial<CompositionRunServices>;
  };
}

export function compositionServices(
  options: WsCompositionOptions,
): CompositionProtocolServices {
  return {
    ...DEFAULT_SERVICES,
    ...options.compositionServices,
    run: {
      ...DEFAULT_COMPOSITION_RUN_SERVICES,
      ...options.compositionServices?.run,
    },
  };
}

export function authoritativeComposition(
  request: Extract<
    CompositionClientEvent,
    { type: "run_composition" | "run_saved_workflow" }
  >,
  directory: string,
  profile: SystemProfile,
  build: typeof buildComposition,
): { recipe: CompositionRecipe; persist: boolean } {
  if (request.type === "run_composition") {
    return {
      recipe: build({
        name: request.name, workflow_ids: request.workflow_ids,
        arch: profile.architecture,
      }, directory),
      persist: true,
    };
  }
  const saved = loadSaved(directory).find((recipe) => recipe.name === request.workflow_id);
  if (!saved) throw new Error(`saved workflow not found: ${request.workflow_id}`);
  if (isAtomicRecipe(saved)) {
    throw new Error("atomic workflows require the legacy staged-files request");
  }
  return { recipe: saved, persist: false };
}
