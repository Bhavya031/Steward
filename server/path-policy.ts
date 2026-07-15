import { constants, accessSync, lstatSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { commandAliases, requireAbsolute } from "./command-path.ts";
import { classifyCommand } from "./flag-policy.ts";
import { PathPolicyError } from "./path-error.ts";
import type { PlanTool } from "./plan.ts";
export { PathPolicyError } from "./path-error.ts";
export interface ValidatedPaths {
  inputs: string[];
  output: string;
  outputDirectory: string;
}
export interface CommandPathOptions {
  requireOutput?: boolean;
  temporaryDirectory?: string | null;
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

export function validateOutput(path: string, permittedRoots: string[]): {
  raw: string;
  real: string;
  rawDirectory: string;
  realDirectory: string;
} {
  const raw = requireAbsolute(path, "output path");
  if (/[*?[\]]|%\d*d/.test(basename(raw))) throw new PathPolicyError("output patterns are not allowed");
  const rawDirectory = dirname(raw);
  let realDirectory: string;
  try {
    realDirectory = realpathSync(rawDirectory);
    if (!statSync(realDirectory).isDirectory()) throw new Error("not a directory");
  } catch {
    throw new PathPolicyError(`output directory is missing or invalid: ${rawDirectory}`);
  }
  let status: ReturnType<typeof lstatSync> | null = null;
  try {
    status = lstatSync(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new PathPolicyError(`cannot inspect output path: ${path}`);
    }
  }
  let real = join(realDirectory, basename(raw));
  if (status) {
    try {
      real = realpathSync(raw);
    } catch {
      throw new PathPolicyError(`refusing to overwrite output symlink: ${path}`);
    }
  }
  const roots = permittedRoots.map((root) => realpathSync(requireAbsolute(root, "output root")));
  if (!roots.some((root) => contains(root, realDirectory) && contains(root, real))) {
    throw new PathPolicyError("output path is outside the input directory and Steward temp root");
  }
  try {
    accessSync(realDirectory, constants.W_OK);
  } catch {
    throw new PathPolicyError(`output directory is not writable: ${rawDirectory}`);
  }
  if (status) {
    const kind = status.isSymbolicLink() ? "symlink" : "existing path";
    throw new PathPolicyError(`refusing to overwrite output ${kind}: ${path}`);
  }
  return { raw, real, rawDirectory, realDirectory };
}

function contains(directory: string, candidate: string): boolean {
  const child = relative(directory, candidate);
  return child === "" || (!child.startsWith("..") && !child.startsWith("/"));
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
  const seen = new Set<string>();
  let outputSeen = false;

  for (const candidate of classifyCommand(tool, command)) {
    const aliases = commandAliases(candidate.value, candidate.role);
    const allowed = candidate.role === "input" ? aliases.some((path) => inputAliases.has(path))
      : candidate.role === "output" ? aliases.some((path) => outputAliases.has(path))
        : candidate.role === "output-directory" ? aliases.some((path) => outputDirectories.has(path))
          : aliases.some((path) => inside(temporaryDirectory, path));
    if (!allowed) throw new PathPolicyError(`${candidate.role} path was not explicitly granted: ${candidate.value}`);
    aliases.forEach((path) => seen.add(path));
    if (candidate.role === "output" || candidate.role === "output-directory") outputSeen = true;
  }
  for (const input of inputs) {
    if (!seen.has(input.raw) && !seen.has(input.real)) {
      throw new PathPolicyError(`command does not reference granted input: ${input.raw}`);
    }
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
  };
}
