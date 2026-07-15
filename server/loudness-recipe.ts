import { executeLoudnessMeasurement, type ExecutionOptions } from "./executor.ts";
import type { SystemProfile } from "./probe.ts";
import type { Recipe } from "./recipe-types.ts";
import type { RecipeSlotValue } from "./recipe-template.ts";
import { parseLoudnessStats } from "./verify/loudness-parser.ts";

const FILTER_SLOT = "{{loudnorm_filter}}";

function finite(value: number | undefined, name: string): number {
  if (value === undefined || !Number.isFinite(value)) {
    throw new Error(`cannot specialize loudness recipe: ${name} is unavailable`);
  }
  return value;
}

export async function loudnessRecipeSlots(
  recipe: Recipe,
  files: string[],
  profile: SystemProfile,
  executionOptions: ExecutionOptions = {},
): Promise<Record<string, RecipeSlotValue>> {
  const needsFilter = recipe.command_template.commands.flat().includes(FILTER_SLOT);
  if (!needsFilter) return {};
  if (!files[0]) throw new Error("loudness recipe requires one input file");
  const target = recipe.checks.find((check) => check.type === "loudness_matches")?.target;
  const peak = recipe.checks.find((check) => check.type === "true_peak_under")?.target;
  if (typeof target !== "number" || typeof peak !== "number") {
    throw new Error("loudness recipe requires numeric loudness and true-peak checks");
  }
  const scan = await executeLoudnessMeasurement(
    files[0], target, peak, profile, executionOptions,
  );
  if (!scan.ok) throw new Error(`cannot measure loudness recipe input: ${scan.stderr_tail}`);
  const stats = parseLoudnessStats(scan.stderr_tail);
  const parts = [
    `I=${target}`, `TP=${peak}`, "LRA=11",
    `measured_I=${finite(stats.inputI, "input_i")}`,
    `measured_TP=${finite(stats.inputTp, "input_tp")}`,
    `measured_LRA=${finite(stats.inputLra, "input_lra")}`,
    `measured_thresh=${finite(stats.inputThresh, "input_thresh")}`,
    `offset=${finite(stats.targetOffset, "target_offset")}`,
    "linear=true", "print_format=summary",
  ];
  return { loudnorm_filter: `loudnorm=${parts.join(":")}` };
}
