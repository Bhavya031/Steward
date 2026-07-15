import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { executePlan } from "./executor.ts";
import { recipeConfidence } from "./recipe-match.ts";
import { renderRecipe, templatizePlan } from "./recipe-template.ts";
import type { Recipe, RecipeMatch, RecipeRun, RerunOptions, SaveRecipeInput } from "./recipe-types.ts";
import { validateRecipe } from "./recipe-validation.ts";
import { probeSystem } from "./probe.ts";
import { installWeightFor } from "./tools.ts";
import { verifyChecks } from "./verify/index.ts";

export const RECIPES_DIRECTORY = join(import.meta.dir, "..", "recipes");
const MATCH_THRESHOLD = 0.45;

export function save(
  input: SaveRecipeInput,
  directory = RECIPES_DIRECTORY,
): Recipe | null {
  const checksGreen =
    input.verification.length === input.plan.checks.length &&
    input.verification.every((check, index) =>
      check.pass && check.name === input.plan.checks[index]?.type
    );
  if (!checksGreen) return null;
  const templated = templatizePlan(input.plan, input.inputPaths, input.name);
  const recipe = validateRecipe({
    name: input.name,
    replaced_service: input.replaced_service,
    monthly_price: input.monthly_price,
    command_template: templated.command_template,
    checks: templated.checks,
    created_at: input.createdAt ?? new Date().toISOString(),
    arch: input.arch,
    tool: input.plan.tool,
    install_weight: installWeightFor(input.plan.tool),
  });
  mkdirSync(directory, { recursive: true });
  const destination = join(directory, `${recipe.name}.json`);
  const temporary = join(directory, `.${recipe.name}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, `${JSON.stringify(recipe, null, 2)}\n`, { flag: "wx" });
    renameSync(temporary, destination);
  } finally {
    rmSync(temporary, { force: true });
  }
  return recipe;
}

export function load(directory = RECIPES_DIRECTORY): Recipe[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const path = join(directory, name);
      const status = lstatSync(path);
      if (!status.isFile() || status.isSymbolicLink()) throw new Error(`recipe is not a regular file: ${name}`);
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(path, "utf8"));
      } catch (error) {
        throw new Error(`recipe JSON is invalid (${name}): ${error instanceof Error ? error.message : String(error)}`);
      }
      return validateRecipe(parsed);
    });
}

export function match(
  taskDescription: string,
  files: string[],
  directory = RECIPES_DIRECTORY,
): RecipeMatch | null {
  let best: RecipeMatch | null = null;
  for (const recipe of load(directory)) {
    const confidence = recipeConfidence(recipe, taskDescription, files);
    if (!best || confidence > best.confidence) best = { recipe, confidence };
  }
  return best && best.confidence >= MATCH_THRESHOLD ? best : null;
}

export async function rerun(
  recipe: Recipe,
  files: string[],
  options: RerunOptions = {},
): Promise<RecipeRun> {
  const trustedRecipe = validateRecipe(recipe);
  const normalizedFiles = files.map((file) => resolve(file));
  const plan = renderRecipe(trustedRecipe, normalizedFiles);
  const profile = options.profile ?? probeSystem();
  const execution = await executePlan(plan, profile, normalizedFiles, options.executionOptions);
  const checks = await verifyChecks(plan.checks, {
    outputPath: plan.output_path,
    sourcePaths: normalizedFiles,
    profile,
  });
  return {
    plan,
    execution,
    checks,
    all_pass: execution.ok && checks.length === plan.checks.length && checks.every((check) => check.pass),
    model_calls: 0,
  };
}

export { renderRecipe } from "./recipe-template.ts";
export type { Recipe, RecipeMatch, RecipeRun, RerunOptions, SaveRecipeInput } from "./recipe-types.ts";
