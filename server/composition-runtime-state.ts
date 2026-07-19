import type {
  AtomicRecipe, CompositionRecipe, CompositionStage,
} from "./recipe-types.ts";
import type {
  CompositionRun, CompositionStageRun,
} from "./composition-runtime-types.ts";

export function stageRecipe(
  composition: CompositionRecipe,
  stage: CompositionStage,
): AtomicRecipe {
  return {
    name: stage.source_id,
    command_template: stage.command_template,
    checks: stage.checks,
    created_at: composition.created_at,
    arch: composition.arch,
    tool: stage.tool,
    install_weight: stage.install_weight,
    ...(stage.derivations ? { derivations: stage.derivations } : {}),
    ...(stage.intermediates ? { intermediates: stage.intermediates } : {}),
    ...(stage.resources ? { resources: stage.resources } : {}),
  };
}

export function failedComposition(
  composition: CompositionRecipe,
  stages: CompositionStageRun[],
  stageIndex: number,
): CompositionRun {
  return {
    composition_id: composition.name,
    success: false,
    failed_stage: stageIndex,
    stages,
    model_calls: 0,
  };
}
