import { constants, accessSync, realpathSync, statSync } from "node:fs";
import { dirname, relative } from "node:path";
import { commandAliases, requireAbsolute } from "./command-path.ts";
import { classifyCommand } from "./flag-policy.ts";
import { validateOutput } from "./output-policy.ts";
import { PathPolicyError } from "./path-error.ts";
import type { PlanTool } from "./plan.ts";
export { PathPolicyError } from "./path-error.ts";
export { validateOutput } from "./output-policy.ts";
export interface ValidatedPaths {
  inputs: string[];
  output: string;
  outputDirectory: string;
  intermediateOutputs: string[];
}
export interface CommandPathOptions {
  requireOutput?: boolean;
  temporaryDirectory?: string | null;
  declaredIntermediates?: string[];
  readableIntermediates?: string[];
}
function validateInput(path: string): { raw: string; real: string } {
  const raw = requireAbsolute(path, "input path");
  let real: string;
  try {
    real = realpathSync(raw);
    if (!statSync(real).isFile()) throw new Error("not a regular file");
    accessSync(real, constants.R_OK);
  } catch {
    throw new PathPolicyError(`input is not a readable regular file: ${path}`);
  }
  return { raw, real };
}

function contains(directory: string, candidate: string): boolean {
  const child = relative(directory, candidate);
  return child === "" || (!child.startsWith("..") && !child.startsWith("/"));
}

function matchedPath(aliases: string[], paths: string[]): string | undefined {
  return paths.find((path) => commandAliases(path, "intermediate path")
    .some((candidate) => aliases.includes(candidate)));
}

function inside(directory: string | null, candidate: string): boolean {
  return directory !== null && candidate !== directory && contains(directory, candidate);
}

export function validateCommandPaths(
  tool: PlanTool,
  command: string[],
  inputPaths: unknown,
  outputPath: string,
  options: CommandPathOptions = {},
): ValidatedPaths {
  if (!Array.isArray(inputPaths) || !inputPaths.every((path) => typeof path === "string")) {
    throw new PathPolicyError("input paths must be an array of absolute path strings");
  }
  const inputs = inputPaths.map(validateInput);
  const temporaryDirectory = options.temporaryDirectory
    ? realpathSync(requireAbsolute(options.temporaryDirectory, "temporary directory"))
    : null;
  const outputRoots = [
    ...inputs.map((input) => dirname(input.real)),
    ...(temporaryDirectory ? [temporaryDirectory] : []),
  ];
  const output = validateOutput(outputPath, outputRoots);
  const inputAliases = new Set(inputs.flatMap((input) => [input.raw, input.real]));
  const outputAliases = new Set([output.raw, output.real]);
  const outputDirectories = new Set([output.rawDirectory, output.realDirectory]);
  const declared = options.declaredIntermediates ?? [];
  const readable = options.readableIntermediates ?? [];
  if ([...declared, ...readable].some((path) => !inside(temporaryDirectory, path))) {
    throw new PathPolicyError("intermediate path is outside the Steward temp root");
  }
  const seen = new Set<string>();
  const intermediateOutputs: string[] = [];
  let sourceSeen = false;
  let outputSeen = false;

  for (const candidate of classifyCommand(tool, command)) {
    const aliases = commandAliases(candidate.value, candidate.role);
    const intermediateInput = candidate.role === "input" ? matchedPath(aliases, readable) : undefined;
    const intermediateOutput = candidate.role === "output" ? matchedPath(aliases, declared) : undefined;
    const input = aliases.some((path) => inputAliases.has(path));
    const finalOutput = aliases.some((path) => outputAliases.has(path));
    const allowed = candidate.role === "input" ? input || intermediateInput !== undefined
      : candidate.role === "output" ? finalOutput || intermediateOutput !== undefined
        : candidate.role === "output-directory" ? aliases.some((path) => outputDirectories.has(path))
          : aliases.some((path) => inside(temporaryDirectory, path));
    if (!allowed) throw new PathPolicyError(`${candidate.role} path was not explicitly granted: ${candidate.value}`);
    aliases.forEach((path) => seen.add(path));
    if (candidate.role === "input") sourceSeen = true;
    if (intermediateOutput) intermediateOutputs.push(intermediateOutput);
    if (finalOutput || candidate.role === "output-directory") outputSeen = true;
  }
  if (readable.length === 0) {
    for (const input of inputs) {
      if (!seen.has(input.raw) && !seen.has(input.real)) {
        throw new PathPolicyError(`command does not reference granted input: ${input.raw}`);
      }
    }
  } else if (!sourceSeen) {
    throw new PathPolicyError("command does not reference a granted input or produced intermediate");
  }
  if (options.requireOutput !== false && !outputSeen) {
    throw new PathPolicyError("command does not reference the granted output path");
  }
  if (options.requireOutput === false && outputSeen) {
    throw new PathPolicyError("only the final command may reference the granted output path");
  }
  if (inputAliases.has(output.raw) || inputAliases.has(output.real)) {
    throw new PathPolicyError("output path must differ from every input path");
  }
  return {
    inputs: inputs.map((input) => input.real),
    output: output.real,
    outputDirectory: output.realDirectory,
    intermediateOutputs,
  };
}
