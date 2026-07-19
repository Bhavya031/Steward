import type { CompositionContract } from "../../../server/composition-contract.ts";
import type { ComposableCatalogEntry } from "../../../server/composition-catalog.ts";
import type {
  AtomicRecipe, CompositionStage,
} from "../../../server/recipe-types.ts";
import type {
  CompositionDetail, CompositionSavedSummary,
} from "../../../server/ws-composition-events.ts";

export interface CompositionStageView extends CompositionStage {
  stage_index: number;
}

export interface CompositionCommand {
  kind: "composition";
  name: string;
  created_at: string;
  stage_count: number;
  composition_contract?: CompositionContract;
  stages: CompositionStageView[];
  detail?: CompositionDetail;
}

export type SavedCommand = AtomicRecipe | CompositionCommand;

export function isCompositionCommand(value: SavedCommand): value is CompositionCommand {
  return value.kind === "composition";
}

function atomicStage(recipe: AtomicRecipe, contract: CompositionContract): CompositionStage {
  return {
    source_id: recipe.name,
    command_template: structuredClone(recipe.command_template),
    checks: structuredClone(recipe.checks),
    tool: recipe.tool,
    install_weight: recipe.install_weight,
    ...(recipe.derivations ? { derivations: structuredClone(recipe.derivations) } : {}),
    ...(recipe.intermediates ? { intermediates: [...recipe.intermediates] } : {}),
    ...(recipe.resources ? { resources: [...recipe.resources] } : {}),
    composition_contract: structuredClone(contract),
  };
}

export function selectedStageSnapshots(
  workflowIds: string[],
  atomic: AtomicRecipe[],
  compositions: CompositionCommand[],
  catalog: ComposableCatalogEntry[],
): CompositionStageView[] {
  const stages = workflowIds.flatMap((id) => {
    const composition = compositions.find((candidate) => candidate.name === id);
    if (composition?.stages.length) {
      return composition.stages.map(({ stage_index: _index, ...stage }) => structuredClone(stage));
    }
    const recipe = atomic.find((candidate) => candidate.name === id);
    const catalogEntry = catalog.find((candidate) =>
      candidate.workflow_id === id && candidate.eligible
    );
    return recipe && catalogEntry?.eligible
      ? [atomicStage(recipe, catalogEntry.contract)] : [];
  });
  return stages.map((stage, stage_index) => ({ ...stage, stage_index }));
}

export function savedComposition(
  summary: CompositionSavedSummary,
  stages: CompositionStageView[],
): CompositionCommand {
  return {
    kind: "composition",
    name: summary.workflow_id,
    created_at: summary.created_at,
    stage_count: summary.stage_count,
    composition_contract: structuredClone(summary.contract),
    stages: stages.map((stage) => structuredClone(stage)),
  };
}

export function compositionFromDetail(
  detail: CompositionDetail,
  stages: CompositionStageView[] = [],
): CompositionCommand {
  return {
    kind: "composition",
    name: detail.workflow_id,
    created_at: detail.created_at,
    stage_count: detail.stage_count,
    composition_contract: structuredClone(detail.contract),
    stages: stages.map((stage) => structuredClone(stage)),
    detail: structuredClone(detail),
  };
}

export function compositionSummary(
  name: string, stageCount: number, contract?: CompositionContract,
): CompositionCommand {
  return {
    kind: "composition", name, created_at: "",
    stage_count: stageCount,
    ...(contract ? { composition_contract: structuredClone(contract) } : {}),
    stages: [],
  };
}

export function compositionDetailRows(command: CompositionCommand) {
  if (!command.detail) return [];
  return command.detail.stages.map((stage) => ({
    stageIndex: stage.stage_index,
    sourceId: stage.source_id,
    sourceTitle: stage.source_title,
    tools: [...stage.tools],
    resources: [...stage.resources],
    commands: stage.command_templates.map((argv) => [...argv]),
    outputTemplate: stage.output_template,
    checks: stage.checks.map((check) => ({
      checkId: check.check_id,
      checkIndex: check.check_index,
      stageIndex: check.stage_index,
      sourceId: check.source_id,
      name: check.name,
      target: check.target,
    })),
  }));
}

export function exportAvailability(command: SavedCommand): {
  script: boolean;
  raycast: boolean;
  reason?: string;
} {
  return isCompositionCommand(command)
    ? {
      script: false, raycast: false,
      reason: "Combined commands use managed and verified stage handoffs inside Steward.",
    }
    : { script: true, raycast: true };
}
