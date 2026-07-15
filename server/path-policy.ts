import { constants, accessSync, existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { candidateFromArgument, requireAbsolute } from "./command-path.ts";
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

function validateOutput(path: string): {
  raw: string;
  real: string;
  rawDirectory: string;
  realDirectory: string;
} {
  const raw = requireAbsolute(path, "output path");
  if (/[*?[\]]|%\d*d/.test(basename(raw))) throw new PathPolicyError("output patterns are not allowed");
  if (existsSync(raw)) {
    const kind = lstatSync(raw).isSymbolicLink() ? "symlink" : "existing path";
    throw new PathPolicyError(`refusing to overwrite output ${kind}: ${path}`);
  }
  const rawDirectory = dirname(raw);
  try {
    const realDirectory = realpathSync(rawDirectory);
    if (!statSync(realDirectory).isDirectory()) throw new Error("not a directory");
    accessSync(realDirectory, constants.W_OK);
    return {
      raw,
      real: join(realDirectory, basename(raw)),
      rawDirectory,
      realDirectory,
    };
  } catch {
    throw new PathPolicyError(`output directory is missing or not writable: ${rawDirectory}`);
  }
}

function inside(directory: string | null, candidate: string): boolean {
  if (!directory) return false;
  const child = relative(directory, candidate);
  return child !== "" && !child.startsWith("..") && !child.startsWith("/");
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
  const output = validateOutput(outputPath);
  const temporaryDirectory = options.temporaryDirectory
    ? requireAbsolute(options.temporaryDirectory, "temporary directory")
    : null;
  const allowed = new Set([
    ...inputs.flatMap((input) => [input.raw, input.real]),
    output.raw,
    output.real,
    output.rawDirectory,
    output.realDirectory,
  ]);
  const seen = new Set<string>();

  for (const argument of command.slice(1)) {
    const candidate = candidateFromArgument(tool, argument);
    if (candidate === null) continue;
    const normalized = requireAbsolute(candidate, "command path");
    if (!allowed.has(normalized) && !inside(temporaryDirectory, normalized)) {
      throw new PathPolicyError(`command path was not explicitly granted: ${candidate}`);
    }
    seen.add(normalized);
  }
  for (const input of inputs) {
    if (!seen.has(input.raw) && !seen.has(input.real)) {
      throw new PathPolicyError(`command does not reference granted input: ${input.raw}`);
    }
  }
  const outputSeen = seen.has(output.raw) || seen.has(output.real);
  const sofficeOutdir =
    tool === "soffice" &&
    (seen.has(output.rawDirectory) || seen.has(output.realDirectory));
  if (options.requireOutput !== false && !outputSeen && !sofficeOutdir) {
    throw new PathPolicyError("command does not reference the granted output path");
  }
  if (options.requireOutput === false && (outputSeen || sofficeOutdir)) {
    throw new PathPolicyError("only the final command may reference the granted output path");
  }
  const inputAliases = new Set(inputs.flatMap((input) => [input.raw, input.real]));
  if (inputAliases.has(output.raw) || inputAliases.has(output.real)) {
    throw new PathPolicyError("output path must differ from every input path");
  }
  return {
    inputs: inputs.map((input) => input.real),
    output: output.real,
    outputDirectory: output.realDirectory,
  };
}
