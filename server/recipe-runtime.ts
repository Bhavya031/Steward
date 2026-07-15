import { resolveDerivationSlots } from "./derivation-runtime.ts";
import type { SystemProfile } from "./probe.ts";
import type { Recipe } from "./recipe-types.ts";

export async function runtimeRecipeSlots(
  recipe: Recipe,
  files: string[],
  profile: SystemProfile,
): Promise<Record<string, string>> {
  return resolveDerivationSlots(recipe.derivations, files, profile);
}
