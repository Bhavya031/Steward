import { deriveCompositionContract } from "./composition-contract.ts";
import type { Derivations } from "./derivations.ts";
import type { PlanCheck } from "./plan.ts";
import type { CompositionRecipe, CompositionStage } from "./recipe-types.ts";
import { isAtomicRecipe, validateSavedRecipe } from "./recipe-validation.ts";

interface StageOptions {
  id: string;
  suffix: string;
  format?: "mkv" | "mov" | "mp4";
  args?: string[];
  checks?: PlanCheck[];
  derivations?: Derivations;
  intermediate?: boolean;
}

export function videoStage(options: StageOptions): CompositionStage {
  const format = options.format ?? "mp4";
  const output = `{{input_0_dir}}/{{input_0_stem}}-${options.suffix}.${format}`;
  const checks = options.checks ?? [
    { type: "format_matches", target: format },
    { type: "streams_present", target: "video" },
    { type: "plays", target: true },
  ];
  const commands = options.intermediate
    ? [
      ["ffmpeg", "-loglevel", "error", "-i", "{{input_0}}",
        "-c", "copy", "{{temp_dir}}/stage.mkv"],
      ["ffmpeg", "-loglevel", "error", "-i", "{{temp_dir}}/stage.mkv",
        "-c", "copy", output],
    ]
    : [[
      "ffmpeg", "-loglevel", "error", "-i", "{{input_0}}",
      ...(options.args ?? ["-c", "copy"]), output,
    ]];
  const source = {
    tool: "ffmpeg" as const,
    command_template: { commands, output_path: output },
    checks,
  };
  const contract = deriveCompositionContract(source);
  if (!contract) throw new Error(`test stage contract is ambiguous: ${options.id}`);
  return {
    source_id: options.id,
    ...source,
    install_weight: "light",
    ...(options.derivations ? { derivations: options.derivations } : {}),
    ...(options.intermediate ? { intermediates: ["{{temp_dir}}/stage.mkv"] } : {}),
    composition_contract: contract,
  };
}

export function composition(name: string, stages: CompositionStage[]): CompositionRecipe {
  const saved = validateSavedRecipe({
    kind: "composition",
    name,
    created_at: "2026-07-19T06:30:00.000Z",
    arch: "arm64",
    stages,
    composition_contract: {
      input: stages[0]!.composition_contract.input,
      output: stages.at(-1)!.composition_contract.output,
    },
  });
  if (isAtomicRecipe(saved)) throw new Error("test composition validated as atomic");
  return saved;
}
