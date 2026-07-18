import { ExecutionError } from "./execution-types.ts";
import type { Plan } from "./plan.ts";
import { validateCommandPaths } from "./path-policy.ts";
import { validateOutput } from "./output-policy.ts";
import type { RuntimeCommands } from "./runtime-temp.ts";

export function validatePlanPaths(
  plan: Plan,
  runtime: RuntimeCommands,
  inputPaths: unknown,
  trustedInputs: string[] = [],
): void {
  if (runtime.intermediates.length > 0 && !runtime.directory) {
    throw new ExecutionError("declared intermediates require a Steward temp root");
  }
  const declared = runtime.intermediates.map((path) =>
    validateOutput(path, [runtime.directory!], "Steward temp root").real
  );
  const produced = new Set<string>();
  runtime.commands.forEach((command, index) => {
    const checked = validateCommandPaths(command[0] as Plan["tool"], command, inputPaths, plan.output_path, {
      requireOutput: index === runtime.commands.length - 1,
      temporaryDirectory: runtime.directory,
      declaredIntermediates: declared,
      readableIntermediates: [...produced],
      trustedInputs,
    });
    checked.intermediateOutputs.forEach((path) => produced.add(path));
  });
  const unused = declared.find((path) => !produced.has(path));
  if (unused) throw new ExecutionError(`declared intermediate is never written: ${unused}`);
}
