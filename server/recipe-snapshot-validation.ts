import { checkSemanticError } from "./check-policy.ts";
import { validateCommandSlots, validateDerivations, type Derivation, type Derivations } from "./derivations.ts";
import { classifyCommand } from "./flag-policy.ts";
import type { ClassifiedPath } from "./flag-policy-core.ts";
import { validateIntermediates } from "./intermediate-policy.ts";
import { CHECK_TYPES, type CheckTarget, type PlanCheck, type PlanCheckType, type PlanTool } from "./plan.ts";
import type { AtomicRecipe } from "./recipe-types.ts";
import { TOOL_POLICIES, type InstallWeight } from "./tools.ts";
import { resourceSlot, validateResources, type TrustedResourceId } from "./trusted-resources.ts";

const CHECK_TYPE_SET = new Set<string>(CHECK_TYPES);
const INPUT_PATH_SLOT = /^\{\{input_\d+\}\}$/;
const INPUT_DIR_SLOT = /^\{\{input_\d+_dir\}\}$/;
const TEMP_CHILD = /^\{\{temp_dir\}\}\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SOURCE_TARGET_CHECKS = new Set(["duration_matches", "page_count_matches", "text_extractable"]);

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

function policyValue(spec: Derivation): string {
  switch (spec.name) {
    case "size_target_video_bitrate": return "1000k";
  }
}

function policyCommand(command: string[], derivations?: Derivations): string[] {
  return command.map((argument) => argument.replace(
    /\{\{([a-z][a-z0-9_]*)\}\}/g,
    (slot, name: string) => derivations?.[name] ? policyValue(derivations[name]!) : slot,
  ));
}

function originalPathValue(command: string[], path: ClassifiedPath): string {
  const token = command[path.index]!;
  const equals = token.indexOf("=");
  return equals > 0 && token.startsWith("-") ? token.slice(equals + 1) : token;
}

function validateCommandPaths(
  commands: string[][], outputPath: string, derivations: Derivations | undefined,
  intermediates: string[] | undefined, resources: TrustedResourceId[] | undefined,
): void {
  const declaredIntermediates = new Set(intermediates ?? []);
  const resourceSlots = new Set((resources ?? []).map((id) => `{{${resourceSlot(id)}}}`));
  const outputPrefix = outputPath.endsWith(".srt") ? outputPath.slice(0, -4) : outputPath;
  for (const command of commands) {
    const paths = classifyCommand(command[0] as PlanTool, policyCommand(command, derivations));
    for (const path of paths) {
      const value = originalPathValue(command, path);
      const allowed = path.role === "input" && (INPUT_PATH_SLOT.test(value) || resourceSlots.has(value)) ||
        declaredIntermediates.has(value) ||
        path.role === "temporary" && TEMP_CHILD.test(value) ||
        path.role === "output" && value === outputPath ||
        path.role === "output-prefix" && value === outputPrefix ||
        path.role === "output-directory" && INPUT_DIR_SLOT.test(value);
      if (!allowed) throw new Error(`recipe path must use an authorized portable slot: ${value}`);
    }
  }
}

function validateChecks(value: unknown): PlanCheck[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("recipe checks must be non-empty");
  const checks = value.map((check, index) => {
    if (!record(check) || !exactKeys(check, ["type", "target"])) {
      throw new Error(`recipe checks[${index}] is malformed`);
    }
    if (!safeString(check.type) || !CHECK_TYPE_SET.has(check.type)) {
      throw new Error(`recipe checks[${index}].type is unsupported`);
    }
    if (!["string", "number", "boolean"].includes(typeof check.target)) {
      throw new Error(`recipe checks[${index}].target is unsupported`);
    }
    if (typeof check.target === "string") {
      if (SOURCE_TARGET_CHECKS.has(check.type) && !INPUT_PATH_SLOT.test(check.target)) {
        throw new Error(`recipe checks[${index}].target must use an authorized input slot`);
      }
    }
    return { type: check.type as PlanCheckType, target: check.target as CheckTarget };
  });
  const semanticError = checkSemanticError(checks);
  if (semanticError) throw new Error(`recipe checks are invalid: ${semanticError}`);
  return checks;
}

export interface SnapshotBody {
  command_template: AtomicRecipe["command_template"];
  checks: PlanCheck[];
  tool: PlanTool;
  install_weight: InstallWeight;
  derivations?: Derivations;
  intermediates?: string[];
  resources?: TrustedResourceId[];
}

export function validateSnapshotBody(value: Record<string, unknown>): SnapshotBody {
  if (!record(value.command_template) || !exactKeys(value.command_template, ["commands", "output_path"])) {
    throw new Error("recipe command_template is invalid");
  }
  const commands = value.command_template.commands;
  if (!Array.isArray(commands) || commands.length === 0 || commands.length > 8 ||
      !commands.every((argv) => Array.isArray(argv) && argv.length > 0 && argv.every(safeString)) ||
      !safeString(value.command_template.output_path)) {
    throw new Error("recipe command template strings are invalid");
  }
  const derivations = value.derivations === undefined ? undefined : validateDerivations(value.derivations);
  const intermediates = value.intermediates === undefined ? undefined : validateIntermediates(value.intermediates);
  const resources = value.resources === undefined ? undefined : validateResources(value.resources);
  const resourceSlots = new Set((resources ?? []).map(resourceSlot));
  validateCommandSlots(commands, derivations, (slot) =>
    slot === "temp_dir" || /^input_\d+(?:_(?:dir|name|stem|ext))?$/.test(slot) || resourceSlots.has(slot)
  );
  const outputPrefix = "{{input_0_dir}}/";
  const outputName = value.command_template.output_path.slice(outputPrefix.length);
  if (!value.command_template.output_path.startsWith(outputPrefix) || !outputName ||
      outputName === "." || outputName === ".." || outputName.includes("/")) {
    throw new Error("recipe output must remain inside the first input directory");
  }
  if (!safeString(value.tool) || value.tool === "brew" || !Object.hasOwn(TOOL_POLICIES, value.tool)) {
    throw new Error("recipe tool is not allowlisted");
  }
  const tool = value.tool as PlanTool;
  if (commands.at(-1)?.[0] !== tool ||
      !commands.every((argv) => argv[0] !== "brew" && Object.hasOwn(TOOL_POLICIES, argv[0]!))) {
    throw new Error("recipe commands must be allowlisted and end with the primary tool");
  }
  if (value.install_weight !== TOOL_POLICIES[tool].install_weight) {
    throw new Error("recipe install_weight does not match policy");
  }
  validateCommandPaths(commands, value.command_template.output_path, derivations, intermediates, resources);
  return {
    command_template: { commands: commands.map((argv) => [...argv]), output_path: value.command_template.output_path },
    checks: validateChecks(value.checks), tool, install_weight: value.install_weight as InstallWeight,
    ...(derivations ? { derivations } : {}), ...(intermediates ? { intermediates } : {}),
    ...(resources ? { resources } : {}),
  };
}
