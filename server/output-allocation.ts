import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { validateOutput } from "./output-policy.ts";
import { validatePlan, type Plan } from "./plan.ts";

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
  const inputs = inputPaths.map((path) => realpathSync(resolve(path)));
  const requested = resolve(plan.output_path);
  if (inputs.includes(requested)) throw new Error("output path must differ from every input path");
  const roots = inputs.map(dirname);
  let resolved: string | undefined;
  for (let number = 1; number < Number.MAX_SAFE_INTEGER; number += 1) {
    const next = candidate(requested, number);
    if (occupied(next)) continue;
    resolved = validateOutput(next, roots).real;
    break;
  }
  if (!resolved) throw new Error("could not allocate an available output path");
  const commands = plan.commands.map((command) =>
    command.map((argument) => replaceOutput(argument, plan.output_path, resolved!))
  );
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
        ? replaceOutput(check.target, plan.output_path, resolved!)
        : check.target,
    })),
  });
}
