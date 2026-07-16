import { isAbsolute } from "node:path";
import { checkSemanticError } from "./check-policy.ts";
import { DerivationValidationError, validateCommandSlots, validateDerivations, type Derivations } from "./derivations.ts";
import { IntermediateValidationError, validateIntermediates } from "./intermediate-policy.ts";
import { ALLOWED_BINARIES, type AllowedBinary } from "./tools.ts";
export type PlanTool = Exclude<AllowedBinary, "brew">;
export type CheckTarget = string | number | boolean;
export const CHECK_TYPES = [
  "size_under", "duration_matches", "streams_present", "plays",
  "audio_stream_present", "loudness_matches", "true_peak_under",
  "file_valid", "page_count_positive", "text_extractable", "format_matches",
] as const;
export type PlanCheckType = (typeof CHECK_TYPES)[number];
export interface PlanCheck { type: PlanCheckType; target: CheckTarget }
export interface Plan {
  name: string;
  tool: PlanTool;
  install_cmd: string[] | null;
  commands: string[][];
  output_path: string;
  checks: PlanCheck[];
  derivations?: Derivations;
  intermediates?: string[];
}
const PLAN_TOOLS = new Set<PlanTool>(
  ALLOWED_BINARIES.filter((binary): binary is PlanTool => binary !== "brew"),
);
const VALID_CHECKS = new Set<PlanCheckType>(CHECK_TYPES);
const REQUIRED_PLAN_KEYS = ["name", "tool", "install_cmd", "commands", "output_path", "checks"];
const PLAN_KEYS = [...REQUIRED_PLAN_KEYS, "derivations", "intermediates"];
const RECIPE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export class PlanValidationError extends Error { constructor(message: string) { super(message); this.name = "PlanValidationError"; } }
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}
function isSafeString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !value.includes("\0");
}
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isSafeString);
}
function validateCommands(value: unknown, tool: PlanTool): string[][] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) {
    throw new PlanValidationError("commands must contain 1 to 8 argv arrays");
  }
  return value.map((command, index) => {
    if (!isStringArray(command) || command.length === 0) {
      throw new PlanValidationError(`commands[${index}] must be a non-empty argv array`);
    }
    if (command[0] !== tool) {
      throw new PlanValidationError(`commands[${index}][0] must exactly match tool`);
    }
    return [...command];
  });
}
function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() ?? trimmed;
}
function parseJson(raw: string): unknown {
  const stripped = stripFences(raw);
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  const candidates = [stripped];
  if (start >= 0 && end > start) candidates.push(stripped.slice(start, end + 1));
  for (const candidate of new Set(candidates)) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next defensive extraction before reporting malformed output.
    }
  }
  throw new PlanValidationError("planner returned malformed JSON");
}
function validateCheck(value: unknown, index: number): PlanCheck {
  if (!isObject(value) || !hasExactKeys(value, ["type", "target"])) {
    throw new PlanValidationError(`checks[${index}] must contain only type and target`);
  }
  if (!isSafeString(value.type) || !VALID_CHECKS.has(value.type as PlanCheckType)) {
    throw new PlanValidationError(`checks[${index}].type is not supported`);
  }
  const target = value.target;
  if (!["string", "number", "boolean"].includes(typeof target)) {
    throw new PlanValidationError(`checks[${index}].target has an unsupported type`);
  }
  return { type: value.type as PlanCheckType, target: target as CheckTarget };
}
export function validatePlan(value: unknown): Plan {
  const shape = isObject(value) && Object.keys(value).every((key) => PLAN_KEYS.includes(key)) &&
    REQUIRED_PLAN_KEYS.every((key) => Object.hasOwn(value, key));
  if (!shape) {
    throw new PlanValidationError(
      `plan must contain ${REQUIRED_PLAN_KEYS.join(", ")} and optional derivations/intermediates only`,
    );
  }
  if (!isSafeString(value.name) || value.name.length > 64 || !RECIPE_NAME.test(value.name)) {
    throw new PlanValidationError("name must be a canonical kebab-case recipe name up to 64 characters");
  }
  if (!isSafeString(value.tool) || !PLAN_TOOLS.has(value.tool as PlanTool)) {
    throw new PlanValidationError("tool is not an allowlisted task binary");
  }
  const tool = value.tool as PlanTool;
  const commands = validateCommands(value.commands, tool);
  let derivations: Derivations | undefined;
  let intermediates: string[] | undefined;
  try {
    derivations = value.derivations == null ? undefined : validateDerivations(value.derivations);
    intermediates = value.intermediates == null ? undefined : validateIntermediates(value.intermediates);
    validateCommandSlots(commands, derivations, (slot) => slot === "temp_dir");
  } catch (error) {
    if (error instanceof DerivationValidationError || error instanceof IntermediateValidationError) {
      throw new PlanValidationError(error.message);
    }
    throw error;
  }
  if (!isSafeString(value.output_path) || !isAbsolute(value.output_path)) {
    throw new PlanValidationError("output_path must be an absolute path");
  }
  if (value.install_cmd !== null) {
    if (!isStringArray(value.install_cmd) || value.install_cmd.length < 3) {
      throw new PlanValidationError("install_cmd must be null or a non-empty argv array");
    }
    if (value.install_cmd[0] !== "brew" || value.install_cmd[1] !== "install") {
      throw new PlanValidationError("install_cmd may only propose brew install");
    }
  }
  if (!Array.isArray(value.checks) || value.checks.length === 0) {
    throw new PlanValidationError("checks must be a non-empty array");
  }
  const checks = value.checks.map(validateCheck);
  const checkError = checkSemanticError(checks);
  if (checkError) throw new PlanValidationError(checkError);
  const plan: Plan = {
    name: value.name,
    tool,
    install_cmd: value.install_cmd as string[] | null,
    commands,
    output_path: value.output_path,
    checks,
  };
  if (derivations) plan.derivations = derivations;
  if (intermediates) plan.intermediates = intermediates;
  return plan;
}
export function parsePlan(raw: string): Plan { return validatePlan(parseJson(raw)); }
