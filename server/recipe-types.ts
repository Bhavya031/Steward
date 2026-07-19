import type { ExecutionOptions, ExecutionResult } from "./execution-types.ts";
import type { InstallWeight } from "./tools.ts";
import type { Derivations } from "./derivations.ts";
import type { Plan, PlanCheck, PlanTool } from "./plan.ts";
import type { SystemProfile } from "./probe.ts";
import type { VerificationResult } from "./verify/index.ts";
import type { TrustedResourceId } from "./trusted-resources.ts";
import type { CompositionContract } from "./composition-contract.ts";

export interface AtomicRecipe {
  kind?: "atomic";
  name: string;
  task_signature?: string;
  replaced_service?: string;
  monthly_price?: number;
  command_template: { commands: string[][]; output_path: string };
  checks: PlanCheck[];
  created_at: string;
  arch: string;
  tool: PlanTool;
  install_weight: InstallWeight;
  derivations?: Derivations;
  intermediates?: string[];
  resources?: TrustedResourceId[];
}

export interface CompositionStage {
  source_id: string;
  command_template: AtomicRecipe["command_template"];
  checks: PlanCheck[];
  tool: PlanTool;
  install_weight: InstallWeight;
  derivations?: Derivations;
  intermediates?: string[];
  resources?: TrustedResourceId[];
  composition_contract: CompositionContract;
}

export interface CompositionRecipe {
  kind: "composition";
  name: string;
  created_at: string;
  arch: string;
  stages: CompositionStage[];
  composition_contract: CompositionContract;
}

export type Recipe = AtomicRecipe;
export type SavedRecipe = AtomicRecipe | CompositionRecipe;

export interface SaveRecipeInput {
  plan: Plan;
  taskDescription?: string;
  inputPaths: string[];
  verification: VerificationResult[];
  arch: string;
  createdAt?: string;
}

export interface RecipeMatch {
  recipe: AtomicRecipe;
  confidence: number;
}

export interface RecipeRun {
  plan: Plan;
  execution: ExecutionResult;
  checks: VerificationResult[];
  all_pass: boolean;
  model_calls: 0;
}

export interface RerunOptions {
  profile?: SystemProfile;
  executionOptions?: ExecutionOptions;
  onVerificationStarted?: () => void;
  onVerificationCompleted?: (durationMs: number) => void;
}
