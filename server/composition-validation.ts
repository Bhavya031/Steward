import {
  compositionCompatibility, sameCompositionContract, type CompositionContract,
} from "./composition-contract.ts";
import { validateCompositionContract } from "./composition-contract-validation.ts";
import type { CompositionRecipe, CompositionStage } from "./recipe-types.ts";

export const MAX_COMPOSITION_STAGES = 8;
export const MAX_COMPOSITION_COMMANDS = 8;
export const MAX_PERSISTED_RECIPE_BYTES = 64 * 1_024;
const ARCHITECTURE_SET = new Set(["arm64", "x86_64", "x64"]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function safeSlug(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export function validateCompositionRecipe(
  value: unknown,
  validateStage: (value: unknown, index: number) => CompositionStage,
): CompositionRecipe {
  if (!record(value) || !exactKeys(value, [
    "kind", "name", "created_at", "arch", "stages", "composition_contract",
  ]) || value.kind !== "composition") {
    throw new Error("composition recipe shape is invalid");
  }
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_PERSISTED_RECIPE_BYTES) {
    throw new Error("composition recipe exceeds the 64 KiB persisted-size limit");
  }
  if (!safeSlug(value.name)) throw new Error("composition recipe name must be a lowercase slug");
  if (typeof value.created_at !== "string" || !Number.isFinite(Date.parse(value.created_at))) {
    throw new Error("composition recipe created_at is invalid");
  }
  if (typeof value.arch !== "string" || !ARCHITECTURE_SET.has(value.arch)) {
    throw new Error("composition recipe arch is invalid");
  }
  if (!Array.isArray(value.stages) || value.stages.length < 2 ||
      value.stages.length > MAX_COMPOSITION_STAGES) {
    throw new Error("composition recipe must contain 2 to 8 stages");
  }
  const stages = value.stages.map(validateStage);
  const commandCount = stages.reduce(
    (total, stage) => total + stage.command_template.commands.length, 0,
  );
  if (commandCount > MAX_COMPOSITION_COMMANDS) {
    throw new Error("composition recipe may contain at most 8 argv arrays across all stages");
  }
  for (let index = 1; index < stages.length; index += 1) {
    const compatibility = compositionCompatibility(
      stages[index - 1]!.composition_contract.output,
      stages[index]!.composition_contract.input,
    );
    if (!compatibility.compatible) {
      throw new Error(`composition stages ${index - 1} and ${index} are incompatible: ${compatibility.reason}`);
    }
  }
  const contract = validateCompositionContract(value.composition_contract);
  const derived: CompositionContract = {
    input: stages[0]!.composition_contract.input,
    output: stages.at(-1)!.composition_contract.output,
  };
  if (!sameCompositionContract(contract, derived)) {
    throw new Error("composition recipe contract does not match its stage snapshots");
  }
  return {
    kind: "composition", name: value.name, created_at: value.created_at,
    arch: value.arch, stages, composition_contract: contract,
  };
}

export function compositionSourceId(value: unknown, index: number): string {
  if (!safeSlug(value)) throw new Error(`composition stages[${index}].source_id is invalid`);
  return value;
}

export { validateCompositionContract } from "./composition-contract-validation.ts";
