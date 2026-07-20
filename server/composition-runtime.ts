import { realpathSync } from "node:fs";
import { finalizeCompositionRun, type PrimaryFailure } from "./composition-cleanup.ts";
import {
  allocateFinalStageOutput, allocateInternalStageOutput,
} from "./composition-output-allocation.ts";
import { createCompositionOutputRoot } from "./composition-output-root.ts";
import { resolveDerivationSlots } from "./derivation-runtime.ts";
import { executePlan, type ExecutionOptions } from "./executor.ts";
import { discardFailedOutput } from "./failed-output.ts";
import { probeSystem } from "./probe.ts";
import { renderRecipe } from "./recipe-template.ts";
import { isAtomicRecipe, validateSavedRecipe } from "./recipe-validation.ts";
import {
  failedComposition, stageRecipe,
} from "./composition-runtime-state.ts";
import type {
  CompositionRun, CompositionRuntimeOptions, CompositionStageRun,
} from "./composition-runtime-types.ts";
import { verifyChecks } from "./verify/index.ts";
function stageExecutionOptions(
  options: CompositionRuntimeOptions,
  stageIndex: number,
  sourceId: string,
): ExecutionOptions {
  return {
    ...options.executionOptions,
    onEvent: (event) => {
      options.executionOptions?.onEvent?.(event);
      options.onEvent?.({
        type: "execution", stage_index: stageIndex, source_id: sourceId, event,
      });
    },
  };
}

// Derivation probes and verification helpers are not authored stage commands, so they must
// not reach the numbered `execution` reporter. They keep the caller's cancellation signal,
// timeout, and raw executor stream; their progress is reported by the verification and
// check events instead.
function helperExecutionOptions(options: CompositionRuntimeOptions): ExecutionOptions {
  return { ...options.executionOptions };
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
      options.executionOptions?.signal?.throwIfAborted();
      options.onEvent?.({
        type: "stage_started", stage_index: stageIndex, source_id: stage.source_id,
        check_names: stage.checks.map((check) => check.type),
      });
      const stageOptions = stageExecutionOptions(options, stageIndex, stage.source_id);
      const helperOptions = helperExecutionOptions(options);
      const slots = await resolveDerivationSlots(
        stage.derivations, [stageInput], profile, helperOptions,
      );
      const rendered = renderRecipe(stageRecipe(saved, stage), [stageInput], slots);
      const final = stageIndex === saved.stages.length - 1;
      const plan = final
        ? allocateFinalStageOutput(rendered, stageInput, managed.capability)
        : allocateInternalStageOutput(rendered, stageInput, managed.capability);
      if (final) finalOutput = plan.output_path;
      const execution = await executePlan(
        plan, profile, [stageInput],
        stageOptions, managed.capability,
      );
      if (!execution.ok) {
        stages.push({
          stage_index: stageIndex, source_id: stage.source_id, input_path: stageInput,
          plan, execution, checks: [], all_pass: false,
        });
        run = failedComposition(saved, stages, stageIndex);
        break;
      }
      options.onEvent?.({
        type: "verification_started", stage_index: stageIndex, source_id: stage.source_id,
      });
      const verificationStarted = performance.now();
      const checks = (await verifyChecks(plan.checks, {
        outputPath: plan.output_path,
        sourcePaths: [stageInput],
        profile,
        onExecutionEvent: helperOptions.onEvent,
        executionOptions: helperOptions,
      })).map((result) => ({
        ...result, stage_index: stageIndex, source_id: stage.source_id,
      }));
      options.onEvent?.({
        type: "verification_completed", stage_index: stageIndex, source_id: stage.source_id,
        duration_ms: Math.round(performance.now() - verificationStarted),
      });
      checks.forEach((result) => options.onEvent?.({ type: "check_result", result }));
      const allPass = checks.length === plan.checks.length && checks.every((check) => check.pass);
      options.executionOptions?.signal?.throwIfAborted();
      stages.push({
        stage_index: stageIndex, source_id: stage.source_id, input_path: stageInput,
        plan, execution, checks, all_pass: allPass,
      });
      if (!allPass) {
        run = failedComposition(saved, stages, stageIndex);
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

export type {
  CompositionRun, CompositionRuntimeEvent, CompositionRuntimeOptions,
  CompositionStageRun, StageVerificationResult,
} from "./composition-runtime-types.ts";
