import type { ExecutionOptions, ExecutionResult } from "./execution-types.ts";
import type { InstallWeight } from "./tools.ts";
import type { Plan, PlanCheck, PlanTool } from "./plan.ts";
import type { SystemProfile } from "./probe.ts";
import type { VerificationResult } from "./verify/index.ts";

export interface Recipe {
  name: string;
  replaced_service: string;
  monthly_price: number;
  command_template: { commands: string[][]; output_path: string };
  checks: PlanCheck[];
  created_at: string;
  arch: string;
  tool: PlanTool;
  install_weight: InstallWeight;
}

export interface SaveRecipeInput {
  name: string;
  replaced_service: string;
  monthly_price: number;
  plan: Plan;
  inputPaths: string[];
  verification: VerificationResult[];
  arch: string;
  createdAt?: string;
}

export interface RecipeMatch {
  recipe: Recipe;
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
  taskDescription?: string;
}
