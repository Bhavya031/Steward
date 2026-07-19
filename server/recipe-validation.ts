import {
  deriveCompositionContract, sameCompositionContract, type CompositionContract,
} from "./composition-contract.ts";
import {
  compositionSourceId, validateCompositionContract, validateCompositionRecipe,
} from "./composition-validation.ts";
import type { AtomicRecipe, CompositionStage, SavedRecipe } from "./recipe-types.ts";
import { validateSnapshotBody, type SnapshotBody } from "./recipe-snapshot-validation.ts";

const REQUIRED_ATOMIC_KEYS = [
  "name", "command_template", "checks", "created_at", "arch", "tool", "install_weight",
];
const ATOMIC_KEYS = [
  ...REQUIRED_ATOMIC_KEYS, "kind", "replaced_service", "monthly_price", "derivations", "intermediates",
  "resources", "task_signature",
];
const REQUIRED_STAGE_KEYS = [
  "source_id", "command_template", "checks", "tool", "install_weight", "composition_contract",
];
const STAGE_KEYS = [...REQUIRED_STAGE_KEYS, "derivations", "intermediates", "resources"];

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !value.includes("\0");
}

function legacyAtomicSlug(value: unknown): value is string {
  return safeString(value) && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function validatedContract(
  value: unknown, body: SnapshotBody, required: boolean,
): CompositionContract | undefined {
  const derived = deriveCompositionContract(body);
  if (value === undefined) {
    if (required) throw new Error("composition stage contract is required");
    return derived ?? undefined;
  }
  const persisted = validateCompositionContract(value);
  if (!derived || !sameCompositionContract(persisted, derived)) {
    throw new Error("persisted composition contract does not match the validated command and checks");
  }
  return persisted;
}

function validateStage(value: unknown, index: number): CompositionStage {
  if (!record(value) || !Object.keys(value).every((key) => STAGE_KEYS.includes(key)) ||
      !REQUIRED_STAGE_KEYS.every((key) => Object.hasOwn(value, key))) {
    throw new Error(`composition stages[${index}] shape is invalid`);
  }
  const body = validateSnapshotBody(value);
  return {
    source_id: compositionSourceId(value.source_id, index), ...body,
    composition_contract: validatedContract(value.composition_contract, body, true)!,
  };
}

function validateAtomicRecipe(value: Record<string, unknown>): AtomicRecipe {
  if (!Object.keys(value).every((key) => ATOMIC_KEYS.includes(key)) ||
      !REQUIRED_ATOMIC_KEYS.every((key) => Object.hasOwn(value, key)) ||
      value.kind !== undefined && value.kind !== "atomic") {
    throw new Error("recipe shape is invalid");
  }
  if (!legacyAtomicSlug(value.name)) throw new Error("recipe name must be a lowercase slug");
  const hasService = Object.hasOwn(value, "replaced_service");
  const hasPrice = Object.hasOwn(value, "monthly_price");
  if (hasService !== hasPrice) throw new Error("recipe replacement claim must include service and price");
  if (hasService && !safeString(value.replaced_service)) throw new Error("recipe replaced_service is invalid");
  if (hasPrice && (typeof value.monthly_price !== "number" ||
      !Number.isFinite(value.monthly_price) || value.monthly_price < 0)) {
    throw new Error("recipe monthly_price is invalid");
  }
  if (!safeString(value.created_at) || !Number.isFinite(Date.parse(value.created_at))) {
    throw new Error("recipe created_at is invalid");
  }
  if (!safeString(value.arch)) throw new Error("recipe arch is invalid");
  const body = validateSnapshotBody(value);
  const recipe: AtomicRecipe = {
    ...(value.kind === "atomic" ? { kind: "atomic" as const } : {}),
    name: value.name,
    command_template: body.command_template,
    checks: body.checks,
    created_at: value.created_at,
    arch: value.arch,
    tool: body.tool,
    install_weight: body.install_weight,
  };
  if (value.task_signature !== undefined) {
    if (typeof value.task_signature !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value.task_signature)) {
      throw new Error("recipe task_signature is invalid");
    }
    recipe.task_signature = value.task_signature;
  }
  if (hasService && hasPrice) {
    recipe.replaced_service = value.replaced_service as string;
    recipe.monthly_price = value.monthly_price as number;
  }
  if (body.derivations) recipe.derivations = body.derivations;
  if (body.intermediates) recipe.intermediates = body.intermediates;
  if (body.resources) recipe.resources = body.resources;
  return recipe;
}

export function isAtomicRecipe(recipe: SavedRecipe): recipe is AtomicRecipe {
  return recipe.kind !== "composition";
}

export function validateSavedRecipe(value: unknown): SavedRecipe {
  if (record(value) && value.kind === "composition") return validateCompositionRecipe(value, validateStage);
  if (!record(value)) throw new Error("recipe shape is invalid");
  return validateAtomicRecipe(value);
}

export function validateAtomic(value: unknown): AtomicRecipe {
  const recipe = validateSavedRecipe(value);
  if (!isAtomicRecipe(recipe)) throw new Error("composition recipe requires the composition runtime");
  return recipe;
}

export const validateRecipe = validateAtomic;
