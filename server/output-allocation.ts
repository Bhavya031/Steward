import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { classifyCommand } from "./flag-policy.ts";
import { validateOutput } from "./output-policy.ts";
import { validatePlan, type Plan } from "./plan.ts";

const SOURCE_TARGET_CHECKS = new Set([
  "duration_matches", "page_count_matches", "text_extractable",
]);

function occupied(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function candidate(path: string, number: number): string {
  if (number === 1) return path;
  const extension = extname(path);
  const stem = basename(path, extension);
  return join(dirname(path), `${stem}-${number}${extension}`);
}

function replaceOutput(value: string, from: string, to: string): string {
  if (value.includes(from)) return value.split(from).join(to);
  if (from.endsWith(".srt")) {
    const fromPrefix = from.slice(0, -4);
    const toPrefix = to.endsWith(".srt") ? to.slice(0, -4) : to;
    if (value.includes(fromPrefix)) return value.split(fromPrefix).join(toPrefix);
  }
  return value;
}

export function allocatePlanOutput(plan: Plan, inputPaths: string[]): Plan {
  const rawInputs = inputPaths.map((path) => resolve(path));
  const inputs = rawInputs.map((path) => realpathSync(path));
  const inputAliases = new Set([...rawInputs, ...inputs]);
  const requested = resolve(plan.output_path);
  const requestedIsInput = inputAliases.has(requested);
  const roots = inputs.map(dirname);
  let resolved: string | undefined;
  for (let number = 1; number < Number.MAX_SAFE_INTEGER; number += 1) {
    const next = candidate(requested, number);
    if (occupied(next)) continue;
    resolved = validateOutput(next, roots).real;
    break;
  }
  if (!resolved) throw new Error("could not allocate an available output path");
  const commands = plan.commands.map((command) => {
    const rewritten = [...command];
    for (const path of classifyCommand(plan.tool, command)) {
      if (path.role === "input" || path.role === "temporary") continue;
      rewritten[path.index] = replaceOutput(path.value, plan.output_path, resolved!);
    }
    return rewritten;
  });
  if (resolved !== plan.output_path &&
      JSON.stringify(commands) === JSON.stringify(plan.commands)) {
    throw new Error("output collision cannot be suffixed for a directory-only command");
  }
  return validatePlan({
    ...plan,
    commands,
    output_path: resolved,
    checks: plan.checks.map((check) => ({
      ...check,
      target: typeof check.target === "string"
        ? requestedIsInput && SOURCE_TARGET_CHECKS.has(check.type) &&
            inputAliases.has(resolve(check.target))
          ? check.target
          : replaceOutput(check.target, plan.output_path, resolved!)
        : check.target,
    })),
  });
}
