import { realpathSync } from "node:fs";
import { finalizeCompositionRun, type PrimaryFailure } from "./composition-cleanup.ts";
import {
  allocateFinalStageOutput, allocateInternalStageOutput,
} from "./composition-output-allocation.ts";
import { createCompositionOutputRoot } from "./composition-output-root.ts";
import { resolveDerivationSlots } from "./derivation-runtime.ts";
import { executePlan, type ExecutionOptions, type PlanExecutionResult } from "./executor.ts";
import { discardFailedOutput } from "./failed-output.ts";
import type { Plan } from "./plan.ts";
import { probeSystem, type SystemProfile } from "./probe.ts";
import { renderRecipe } from "./recipe-template.ts";
import type {
  AtomicRecipe, CompositionRecipe, CompositionStage,
} from "./recipe-types.ts";
import { isAtomicRecipe, validateSavedRecipe } from "./recipe-validation.ts";
import { verifyChecks, type VerificationResult } from "./verify/index.ts";
export interface StageVerificationResult extends VerificationResult {
  stage_index: number;
  source_id: string;
}
export interface CompositionStageRun {
  stage_index: number;
  source_id: string;
  input_path: string;
  plan: Plan;
  execution: PlanExecutionResult;
  checks: StageVerificationResult[];
  all_pass: boolean;
}
export interface CompositionRun {
  composition_id: string;
  success: boolean;
  output_path?: string;
  failed_stage?: number;
  stages: CompositionStageRun[];
  model_calls: 0;
}
export interface CompositionRuntimeOptions {
  profile?: SystemProfile;
  executionOptions?: ExecutionOptions;
}
function stageRecipe(
  composition: CompositionRecipe,
  stage: CompositionStage,
): AtomicRecipe {
  return {
    name: stage.source_id,
    command_template: stage.command_template,
    checks: stage.checks,
    created_at: composition.created_at,
    arch: composition.arch,
    tool: stage.tool,
    install_weight: stage.install_weight,
    ...(stage.derivations ? { derivations: stage.derivations } : {}),
    ...(stage.intermediates ? { intermediates: stage.intermediates } : {}),
    ...(stage.resources ? { resources: stage.resources } : {}),
  };
}
function failed(
  composition: CompositionRecipe,
  stages: CompositionStageRun[],
  stageIndex: number,
): CompositionRun {
  return {
    composition_id: composition.name,
    success: false,
    failed_stage: stageIndex,
    stages,
    model_calls: 0,
  };
}
export async function runComposition(
  untrustedComposition: unknown,
  stagedInput: unknown,
  options: CompositionRuntimeOptions = {},
): Promise<CompositionRun> {
  const saved = validateSavedRecipe(untrustedComposition);
  if (isAtomicRecipe(saved)) throw new Error("composition runtime requires a composition recipe");
  const managed = createCompositionOutputRoot(stagedInput);
  const stages: CompositionStageRun[] = [];
  let originalInput: string | undefined;
  let currentInput: string | undefined;
  let finalOutput: string | undefined;
  let run: CompositionRun | undefined;
  let primaryFailure: PrimaryFailure | null = null;
  try {
    originalInput = realpathSync(stagedInput as string);
    let stageInput = originalInput;
    currentInput = stageInput;
    const profile = options.profile ?? probeSystem();
    for (const [stageIndex, stage] of saved.stages.entries()) {
      const slots = await resolveDerivationSlots(stage.derivations, [stageInput], profile);
      const rendered = renderRecipe(stageRecipe(saved, stage), [stageInput], slots);
      const final = stageIndex === saved.stages.length - 1;
      const plan = final
        ? allocateFinalStageOutput(rendered, stageInput, managed.capability)
        : allocateInternalStageOutput(rendered, stageInput, managed.capability);
      if (final) finalOutput = plan.output_path;
      const execution = await executePlan(
        plan, profile, [stageInput], options.executionOptions, managed.capability,
      );
      if (!execution.ok) {
        stages.push({
          stage_index: stageIndex, source_id: stage.source_id, input_path: stageInput,
          plan, execution, checks: [], all_pass: false,
        });
        run = failed(saved, stages, stageIndex);
        break;
      }
      const checks = (await verifyChecks(plan.checks, {
        outputPath: plan.output_path,
        sourcePaths: [stageInput],
        profile,
        onExecutionEvent: options.executionOptions?.onEvent,
      })).map((result) => ({
        ...result, stage_index: stageIndex, source_id: stage.source_id,
      }));
      const allPass = checks.length === plan.checks.length && checks.every((check) => check.pass);
      stages.push({
        stage_index: stageIndex, source_id: stage.source_id, input_path: stageInput,
        plan, execution, checks, all_pass: allPass,
      });
      if (!allPass) {
        run = failed(saved, stages, stageIndex);
        break;
      }
      stageInput = plan.output_path;
      currentInput = stageInput;
    }
    run ??= {
      composition_id: saved.name, success: true, output_path: finalOutput,
      stages, model_calls: 0,
    };
  } catch (error) {
    primaryFailure = { error };
  }
  return finalizeCompositionRun(run, primaryFailure, [
    {
      action: "failed_output",
      run: () => {
        if ((primaryFailure || !run?.success) && finalOutput) {
          discardFailedOutput(finalOutput, [originalInput, currentInput]
            .filter((path): path is string => path !== undefined));
        }
      },
    },
    { action: "managed_root", run: managed.cleanup },
  ]);
}
