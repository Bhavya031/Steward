import { deriveCompositionContract } from "./composition-contract.ts";
import { persistRecipe } from "./recipe-persistence.ts";
import type {
  AtomicRecipe, CompositionRecipe, CompositionStage, SavedRecipe,
} from "./recipe-types.ts";
import { isAtomicRecipe, validateSavedRecipe } from "./recipe-validation.ts";
import { loadSaved, RECIPES_DIRECTORY } from "./recipes.ts";

export interface CompositionSelection {
  name: string;
  workflow_ids: string[];
  arch: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateSelectionShape(value: unknown): asserts value is CompositionSelection {
  if (!record(value)) throw new Error("composition selection shape is invalid");
  const keys = Object.keys(value);
  if (keys.length !== 3 || !["name", "workflow_ids", "arch"].every((key) => Object.hasOwn(value, key))) {
    throw new Error("composition selection shape is invalid");
  }
}

function stableId(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length > 64 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new Error(`${label} must be a lowercase stable workflow ID`);
  }
  return value;
}

function snapshot(recipe: AtomicRecipe): CompositionStage {
  const contract = deriveCompositionContract(recipe);
  if (!contract) throw new Error(`saved workflow is not composition eligible: ${recipe.name}`);
  const source = structuredClone(recipe);
  return {
    source_id: source.name,
    command_template: source.command_template,
    checks: source.checks,
    tool: source.tool,
    install_weight: source.install_weight,
    ...(source.derivations ? { derivations: source.derivations } : {}),
    ...(source.intermediates ? { intermediates: source.intermediates } : {}),
    ...(source.resources ? { resources: source.resources } : {}),
    composition_contract: contract,
  };
}

function catalogById(catalog: SavedRecipe[]): Map<string, SavedRecipe> {
  const indexed = new Map<string, SavedRecipe>();
  for (const recipe of catalog) {
    if (indexed.has(recipe.name)) throw new Error(`duplicate authoritative workflow ID: ${recipe.name}`);
    indexed.set(recipe.name, recipe);
  }
  return indexed;
}

function flatten(
  recipe: SavedRecipe,
  indexed: Map<string, SavedRecipe>,
  forbidden: Set<string>,
): CompositionStage[] {
  if (isAtomicRecipe(recipe)) return [snapshot(recipe)];
  return recipe.stages.map((stage) => {
    if (forbidden.has(stage.source_id)) {
      throw new Error(`composition cycle detected through ${stage.source_id}`);
    }
    const source = indexed.get(stage.source_id);
    if (!source) throw new Error(`composition provenance is missing: ${stage.source_id}`);
    if (!isAtomicRecipe(source)) {
      throw new Error(`nested composition provenance is forbidden: ${stage.source_id}`);
    }
    return structuredClone(stage);
  });
}

export function buildComposition(
  input: CompositionSelection,
  directory = RECIPES_DIRECTORY,
): CompositionRecipe {
  validateSelectionShape(input);
  const name = stableId(input.name, "composition name");
  if (!Array.isArray(input.workflow_ids) || input.workflow_ids.length < 2 ||
      input.workflow_ids.length > 8) {
    throw new Error("composition selection must contain 2 to 8 stable workflow IDs");
  }
  const selected = input.workflow_ids.map((id, index) => stableId(id, `workflow_ids[${index}]`));
  if (new Set(selected).size !== selected.length) throw new Error("duplicate workflow selection is forbidden");
  if (selected.includes(name)) throw new Error("composition cannot select itself");
  const indexed = catalogById(loadSaved(directory));
  if (indexed.has(name)) throw new Error(`composition name already exists: ${name}`);
  const selectedRecipes = selected.map((id) => {
    const recipe = indexed.get(id);
    if (!recipe) throw new Error(`saved workflow not found: ${id}`);
    return recipe;
  });
  const forbidden = new Set([
    name, ...selectedRecipes.filter((recipe) => !isAtomicRecipe(recipe)).map((recipe) => recipe.name),
  ]);
  const stages = selectedRecipes.flatMap((recipe) => flatten(recipe, indexed, forbidden));
  const sourceIds = stages.map((stage) => stage.source_id);
  if (new Set(sourceIds).size !== sourceIds.length) {
    throw new Error("duplicate flattened workflow stage is forbidden");
  }
  const candidate = {
    kind: "composition",
    name,
    created_at: new Date().toISOString(),
    arch: input.arch,
    stages,
    composition_contract: {
      input: stages[0]?.composition_contract.input,
      output: stages.at(-1)?.composition_contract.output,
    },
  };
  return validateSavedRecipe(candidate) as CompositionRecipe;
}

export function createComposition(
  input: CompositionSelection,
  directory = RECIPES_DIRECTORY,
): CompositionRecipe {
  return persistRecipe(buildComposition(input, directory), directory);
}
