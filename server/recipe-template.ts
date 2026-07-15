import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { mediaFormat } from "./media-formats.ts";
import { validatePlan, type CheckTarget, type Plan, type PlanCheck } from "./plan.ts";
import type { Recipe } from "./recipe-types.ts";
import { TEMP_DIR_SLOT } from "./runtime-temp.ts";

export interface TemplatedPlan {
  command_template: Recipe["command_template"];
  checks: PlanCheck[];
}
export type RecipeSlotValue = string | string[];

function portableOutput(plan: Plan, inputPath: string, recipeName: string, dynamicFormat: boolean): string {
  const inputExtension = extname(inputPath);
  const inputStem = basename(inputPath, inputExtension);
  const originalName = basename(plan.output_path);
  const outputExtension = extname(plan.output_path) || inputExtension || ".out";
  let portableName = inputStem && originalName.includes(inputStem)
    ? originalName.replace(inputStem, "{{input_0_stem}}")
    : `{{input_0_stem}}-${recipeName}${outputExtension}`;
  if (dynamicFormat) portableName = `${portableName.slice(0, -extname(portableName).length)}.{{target_format}}`;
  return `{{input_0_dir}}/${portableName}`;
}

function replaceAll(value: string, replacements: Array<[string, string]>): string {
  return replacements.reduce(
    (current, [literal, slot]) => literal ? current.split(literal).join(slot) : current,
    value,
  );
}

export function templatizePlan(plan: Plan, inputPaths: string[], recipeName: string): TemplatedPlan {
  if (inputPaths.length === 0 || inputPaths.some((path) => !isAbsolute(path))) {
    throw new Error("recipe inputs must be absolute paths");
  }
  const targetFormat = plan.checks.find((check) =>
    check.type === "format_matches" && mediaFormat(check.target)
  );
  const dynamicMedia = plan.tool === "ffmpeg" && Boolean(targetFormat) && inputPaths.length === 1;
  const dynamicLoudness = plan.tool === "ffmpeg" && inputPaths.length === 1 &&
    plan.checks.some((check) => check.type === "loudness_matches") &&
    plan.checks.some((check) => check.type === "true_peak_under");
  const output = portableOutput(plan, inputPaths[0]!, recipeName, dynamicMedia);
  const replacements: Array<[string, string]> = [
    [plan.output_path, output],
    ...inputPaths.map((path, index) => [path, `{{input_${index}}}`] as [string, string]),
    [dirname(plan.output_path), "{{input_0_dir}}"],
  ];
  const template = (value: string): string => replaceAll(value, replacements);
  const commands = dynamicMedia
    ? [["ffmpeg", "-i", `{{input_0}}`, "{{media_args}}", output]]
    : dynamicLoudness
      ? [["ffmpeg", "-i", "{{input_0}}", "-af", "{{loudnorm_filter}}", output]]
    : plan.commands.map((command) => command.map(template));
  return {
    command_template: {
      commands,
      output_path: output,
    },
    checks: plan.checks.map((check) => ({
      type: check.type,
      target: dynamicMedia && check.type === "format_matches" ? "{{target_format}}"
        : dynamicMedia && check.type === "streams_present" ? "{{target_streams}}"
          : typeof check.target === "string" ? template(check.target) : check.target,
    })),
  };
}

function slotValues(files: string[]): Record<string, string> {
  if (files.length === 0) throw new Error("recipe rerun requires at least one file");
  const values: Record<string, string> = {};
  files.forEach((file, index) => {
    const path = resolve(file);
    const extension = extname(path);
    values[`input_${index}`] = path;
    values[`input_${index}_dir`] = dirname(path);
    values[`input_${index}_name`] = basename(path);
    values[`input_${index}_stem`] = basename(path, extension);
    values[`input_${index}_ext`] = extension;
  });
  return values;
}

function fill(value: string, slots: Record<string, RecipeSlotValue>): string {
  const rendered = value.replace(/\{\{([a-z0-9_]+)\}\}/g, (_match, name: string) => {
    if (name === "temp_dir") return TEMP_DIR_SLOT;
    const replacement = slots[name];
    if (replacement === undefined) throw new Error(`recipe slot is unfilled: ${name}`);
    if (Array.isArray(replacement)) throw new Error(`recipe argv slot cannot be embedded: ${name}`);
    return replacement;
  });
  const recipeOnly = rendered.split(TEMP_DIR_SLOT).join("");
  if (recipeOnly.includes("{{") || recipeOnly.includes("}}")) {
    throw new Error("recipe contains malformed slots");
  }
  return rendered;
}

function fillTarget(target: CheckTarget, slots: Record<string, RecipeSlotValue>): CheckTarget {
  return typeof target === "string" ? fill(target, slots) : target;
}

export function renderRecipe(
  recipe: Recipe,
  files: string[],
  runtimeSlots: Record<string, RecipeSlotValue> = {},
): Plan {
  const slots = { ...runtimeSlots, ...slotValues(files) };
  return validatePlan({
    tool: recipe.tool,
    install_cmd: null,
    commands: recipe.command_template.commands.map((command) =>
      command.flatMap((argument) => {
        const exact = argument.match(/^\{\{([a-z0-9_]+)\}\}$/)?.[1];
        const value = exact ? slots[exact] : undefined;
        return Array.isArray(value) ? value : [fill(argument, slots)];
      })
    ),
    output_path: fill(recipe.command_template.output_path, slots),
    checks: recipe.checks.map((check) => ({ type: check.type, target: fillTarget(check.target, slots) })),
  });
}
