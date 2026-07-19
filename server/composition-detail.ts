import type {
  CompositionDetail, CompositionDetailCheck, CompositionDetailStage,
} from "./ws-composition-events.ts";
import { isAtomicRecipe, validateSavedRecipe } from "./recipe-validation.ts";
import { loadSaved, RECIPES_DIRECTORY } from "./recipes.ts";

function titleFor(workflowId: string): string {
  return workflowId.split("-").map((word) =>
    `${word.charAt(0).toUpperCase()}${word.slice(1)}`
  ).join(" ");
}

function declaredTools(commands: string[][]): string[] {
  const tools: string[] = [];
  for (const command of commands) {
    const tool = command[0];
    if (!tool) throw new Error("saved composition contains an empty command template");
    if (!tools.includes(tool)) tools.push(tool);
  }
  return tools;
}

function detailCheck(
  stageIndex: number,
  sourceId: string,
  checkIndex: number,
  check: { type: string; target: string | number | boolean },
): CompositionDetailCheck {
  return {
    check_id: `stage-${stageIndex}-check-${checkIndex}`,
    stage_index: stageIndex,
    check_index: checkIndex,
    source_id: sourceId,
    name: check.type,
    target: check.target,
  };
}

function detailStage(
  stageIndex: number,
  stage: ReturnType<typeof compositionRecipe>["stages"][number],
): CompositionDetailStage {
  return {
    stage_index: stageIndex,
    source_id: stage.source_id,
    source_title: titleFor(stage.source_id),
    tools: declaredTools(stage.command_template.commands),
    resources: [...(stage.resources ?? [])],
    command_templates: stage.command_template.commands.map((command) => [...command]),
    output_template: stage.command_template.output_path,
    checks: stage.checks.map((check, checkIndex) =>
      detailCheck(stageIndex, stage.source_id, checkIndex, check)
    ),
  };
}

function compositionRecipe(value: unknown) {
  const saved = validateSavedRecipe(value);
  if (isAtomicRecipe(saved)) throw new Error("saved workflow is not a composition");
  return saved;
}

export function authoritativeCompositionDetail(
  workflowId: string,
  directory = RECIPES_DIRECTORY,
): CompositionDetail {
  const saved = loadSaved(directory).find((workflow) => workflow.name === workflowId);
  if (!saved) throw new Error(`saved composition not found: ${workflowId}`);
  if (isAtomicRecipe(saved)) {
    throw new Error(`saved workflow is not a composition: ${workflowId}`);
  }
  const composition = compositionRecipe(saved);
  const stages = composition.stages.map((stage, stageIndex) =>
    detailStage(stageIndex, stage)
  );
  return {
    workflow_id: composition.name,
    title: titleFor(composition.name),
    created_at: composition.created_at,
    stage_count: stages.length,
    command_count: stages.reduce(
      (total, stage) => total + stage.command_templates.length, 0,
    ),
    contract: structuredClone(composition.composition_contract),
    stages,
    evidence: [],
    history: [],
  };
}
