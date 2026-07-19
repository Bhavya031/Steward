import { deriveCompositionContract, type CompositionContract } from "./composition-contract.ts";
import type { SavedRecipe } from "./recipe-types.ts";
import { isAtomicRecipe } from "./recipe-validation.ts";
import { loadSaved, RECIPES_DIRECTORY } from "./recipes.ts";

export type CompositionIneligibleReason =
  | "ambiguous_or_unsupported_contract"
  | "stage_limit"
  | "command_limit";

export type ComposableCatalogEntry =
  | {
    workflow_id: string;
    kind: "atomic" | "composition";
    eligible: true;
    stage_count: number;
    command_count: number;
    contract: CompositionContract;
  }
  | {
    workflow_id: string;
    kind: "atomic" | "composition";
    eligible: false;
    stage_count: number;
    command_count: number;
    reason: CompositionIneligibleReason;
  };

function counts(recipe: SavedRecipe): { stage_count: number; command_count: number } {
  if (isAtomicRecipe(recipe)) {
    return { stage_count: 1, command_count: recipe.command_template.commands.length };
  }
  return {
    stage_count: recipe.stages.length,
    command_count: recipe.stages.reduce(
      (total, stage) => total + stage.command_template.commands.length, 0,
    ),
  };
}

function entry(recipe: SavedRecipe): ComposableCatalogEntry {
  const kind: "atomic" | "composition" =
    isAtomicRecipe(recipe) ? "atomic" : "composition";
  const size = counts(recipe);
  const base = { workflow_id: recipe.name, kind, ...size };
  if (size.stage_count >= 8) return { ...base, eligible: false, reason: "stage_limit" };
  if (size.command_count >= 8) return { ...base, eligible: false, reason: "command_limit" };
  const contract = isAtomicRecipe(recipe)
    ? deriveCompositionContract(recipe)
    : recipe.composition_contract;
  if (!contract) {
    return { ...base, eligible: false, reason: "ambiguous_or_unsupported_contract" };
  }
  return { ...base, eligible: true, contract };
}

export function composableCatalog(
  directory = RECIPES_DIRECTORY,
): ComposableCatalogEntry[] {
  return loadSaved(directory).map(entry);
}
