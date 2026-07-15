import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { validatePlan, type CheckTarget, type Plan, type PlanCheck } from "./plan.ts";
import type { Recipe } from "./recipe-types.ts";

export interface TemplatedPlan {
  command_template: Recipe["command_template"];
  checks: PlanCheck[];
}

function portableOutput(plan: Plan, inputPath: string, recipeName: string): string {
  const inputExtension = extname(inputPath);
  const inputStem = basename(inputPath, inputExtension);
  const originalName = basename(plan.output_path);
  const outputExtension = extname(plan.output_path) || inputExtension || ".out";
  const portableName = inputStem && originalName.includes(inputStem)
    ? originalName.replace(inputStem, "{{input_0_stem}}")
    : `{{input_0_stem}}-${recipeName}${outputExtension}`;
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
  const output = portableOutput(plan, inputPaths[0]!, recipeName);
  const replacements: Array<[string, string]> = [
    [plan.output_path, output],
    ...inputPaths.map((path, index) => [path, `{{input_${index}}}`] as [string, string]),
    [dirname(plan.output_path), "{{input_0_dir}}"],
  ];
  const template = (value: string): string => replaceAll(value, replacements);
  return {
    command_template: {
      argv: plan.command.map(template),
      output_path: output,
    },
    checks: plan.checks.map((check) => ({
      type: check.type,
      target: typeof check.target === "string" ? template(check.target) : check.target,
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

function fill(value: string, slots: Record<string, string>): string {
  const rendered = value.replace(/\{\{([a-z0-9_]+)\}\}/g, (_match, name: string) => {
    const replacement = slots[name];
    if (replacement === undefined) throw new Error(`recipe slot is unfilled: ${name}`);
    return replacement;
  });
  if (rendered.includes("{{") || rendered.includes("}}")) throw new Error("recipe contains malformed slots");
  return rendered;
}

function fillTarget(target: CheckTarget, slots: Record<string, string>): CheckTarget {
  return typeof target === "string" ? fill(target, slots) : target;
}

export function renderRecipe(recipe: Recipe, files: string[]): Plan {
  const slots = slotValues(files);
  return validatePlan({
    tool: recipe.tool,
    install_cmd: null,
    command: recipe.command_template.argv.map((argument) => fill(argument, slots)),
    output_path: fill(recipe.command_template.output_path, slots),
    checks: recipe.checks.map((check) => ({ type: check.type, target: fillTarget(check.target, slots) })),
  });
}
