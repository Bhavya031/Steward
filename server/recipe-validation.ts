import { CHECK_TYPES, type CheckTarget, type PlanCheck, type PlanCheckType, type PlanTool } from "./plan.ts";
import type { Recipe } from "./recipe-types.ts";
import { TOOL_POLICIES, type InstallWeight } from "./tools.ts";

const RECIPE_KEYS = [
  "name", "replaced_service", "monthly_price", "command_template", "checks",
  "created_at", "arch", "tool", "install_weight",
];
const CHECK_TYPE_SET = new Set<string>(CHECK_TYPES);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function safeString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !value.includes("\0");
}

function validateChecks(value: unknown): PlanCheck[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("recipe checks must be non-empty");
  return value.map((check, index) => {
    if (!record(check) || !exactKeys(check, ["type", "target"])) {
      throw new Error(`recipe checks[${index}] is malformed`);
    }
    if (!safeString(check.type) || !CHECK_TYPE_SET.has(check.type)) {
      throw new Error(`recipe checks[${index}].type is unsupported`);
    }
    if (!["string", "number", "boolean"].includes(typeof check.target)) {
      throw new Error(`recipe checks[${index}].target is unsupported`);
    }
    return { type: check.type as PlanCheckType, target: check.target as CheckTarget };
  });
}

export function validateRecipe(value: unknown): Recipe {
  if (!record(value) || !exactKeys(value, RECIPE_KEYS)) throw new Error("recipe shape is invalid");
  if (!safeString(value.name) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.name)) {
    throw new Error("recipe name must be a lowercase slug");
  }
  if (!safeString(value.replaced_service)) throw new Error("recipe replaced_service is invalid");
  if (typeof value.monthly_price !== "number" || !Number.isFinite(value.monthly_price) || value.monthly_price < 0) {
    throw new Error("recipe monthly_price is invalid");
  }
  if (!record(value.command_template) || !exactKeys(value.command_template, ["argv", "output_path"])) {
    throw new Error("recipe command_template is invalid");
  }
  const argv = value.command_template.argv;
  if (!Array.isArray(argv) || !argv.every(safeString) || !safeString(value.command_template.output_path)) {
    throw new Error("recipe command template strings are invalid");
  }
  if (!value.command_template.output_path.startsWith("{{input_0_dir}}/")) {
    throw new Error("recipe output must remain inside the first input directory");
  }
  if (!safeString(value.tool) || value.tool === "brew" || !Object.hasOwn(TOOL_POLICIES, value.tool)) {
    throw new Error("recipe tool is not allowlisted");
  }
  const tool = value.tool as PlanTool;
  if (argv[0] !== tool) throw new Error("recipe command must start with its tool");
  const expectedWeight = TOOL_POLICIES[tool].install_weight;
  if (value.install_weight !== expectedWeight) throw new Error("recipe install_weight does not match policy");
  if (!safeString(value.created_at) || !Number.isFinite(Date.parse(value.created_at))) {
    throw new Error("recipe created_at is invalid");
  }
  if (!safeString(value.arch)) throw new Error("recipe arch is invalid");
  return {
    name: value.name,
    replaced_service: value.replaced_service,
    monthly_price: value.monthly_price,
    command_template: { argv: [...argv], output_path: value.command_template.output_path },
    checks: validateChecks(value.checks),
    created_at: value.created_at,
    arch: value.arch,
    tool,
    install_weight: value.install_weight as InstallWeight,
  };
}
