import { basename, dirname, join, resolve } from "node:path";
import {
  compositionFinalRoot, compositionInternalRoot,
  type CompositionOutputRootCapability,
} from "./composition-output-root.ts";
import { classifyCommand } from "./flag-policy.ts";
import { allocateAvailableOutput } from "./output-allocation.ts";
import { validatePlan, type Plan, type PlanTool } from "./plan.ts";

const SOURCE_TARGET_CHECKS = new Set([
  "duration_matches", "page_count_matches", "text_extractable",
]);

function outputPrefix(path: string): string {
  return path.endsWith(".srt") ? path.slice(0, -4) : path;
}

function rewrittenPath(
  role: string, value: string, from: string, to: string,
): string | null {
  if (role === "output-directory" && resolve(value) === resolve(dirname(from))) {
    return dirname(to);
  }
  if (role === "output-prefix" && resolve(value) === resolve(outputPrefix(from))) {
    return outputPrefix(to);
  }
  return role === "output" && resolve(value) === resolve(from) ? to : null;
}

function replaceToken(token: string, oldValue: string, newValue: string): string {
  if (token === oldValue) return newValue;
  const equals = token.indexOf("=");
  if (equals > 0 && token.slice(equals + 1) === oldValue) {
    return `${token.slice(0, equals + 1)}${newValue}`;
  }
  throw new Error("classified output path does not match its argv token");
}

function relocate(plan: Plan, inputPath: string, destination: string): Plan {
  if (resolve(plan.output_path) === resolve(destination)) return plan;
  const commands = plan.commands.map((command) => {
    const rewritten = [...command];
    for (const path of classifyCommand(command[0] as PlanTool, command)) {
      const replacement = rewrittenPath(path.role, path.value, plan.output_path, destination);
      if (replacement) rewritten[path.index] = replaceToken(
        command[path.index]!, path.value, replacement,
      );
    }
    return rewritten;
  });
  if (JSON.stringify(commands) === JSON.stringify(plan.commands)) {
    throw new Error("composition output could not be relocated through classified argv paths");
  }
  return validatePlan({
    ...plan,
    commands,
    output_path: destination,
    checks: plan.checks.map((check) => ({
      ...check,
      target: typeof check.target === "string" &&
          !(SOURCE_TARGET_CHECKS.has(check.type) && resolve(check.target) === resolve(inputPath))
        ? check.target.split(plan.output_path).join(destination)
        : check.target,
    })),
  });
}

export function allocateInternalStageOutput(
  plan: Plan,
  inputPath: string,
  capability: CompositionOutputRootCapability,
): Plan {
  const root = compositionInternalRoot(capability);
  const requested = join(root, basename(plan.output_path));
  const allocated = allocateAvailableOutput(requested, [root]);
  return relocate(plan, inputPath, allocated);
}

export function allocateFinalStageOutput(
  plan: Plan,
  inputPath: string,
  capability: CompositionOutputRootCapability,
): Plan {
  const root = compositionFinalRoot(capability);
  const requested = join(root, basename(plan.output_path));
  const allocated = allocateAvailableOutput(requested, [root]);
  return relocate(plan, inputPath, allocated);
}
