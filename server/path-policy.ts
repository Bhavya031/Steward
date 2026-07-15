import { constants, accessSync, existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import type { PlanTool } from "./plan.ts";
export interface ValidatedPaths {
  inputs: string[];
  output: string;
  outputDirectory: string;
}
export class PathPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathPolicyError";
  }
}

function requireAbsolute(path: string, label: string): string {
  if (!path || path.includes("\0") || !isAbsolute(path)) {
    throw new PathPolicyError(`${label} must be an absolute path without NUL bytes`);
  }
  return resolve(path);
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

function candidateFromArgument(tool: PlanTool, argument: string): string | null {
  let candidate = argument;
  const equals = argument.indexOf("=");
  if (equals >= 0) {
    const suffix = argument.slice(equals + 1);
    if (/^(?:\/|\.|~|[a-z][a-z0-9+.-]*:)/i.test(suffix)) candidate = suffix;
  }
  if (/(?:^|:)@(?:\/|\.|~)/.test(candidate)) {
    throw new PathPolicyError(`indirect file references are not allowed: ${candidate}`);
  }
  if (/^(?:https?|ftp|sftp|rtmp|rtsp|concat|subfile|pipe|fd|data):/i.test(candidate)) {
    throw new PathPolicyError(`external protocol is not allowed: ${candidate}`);
  }
  if (candidate.startsWith("file:")) {
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      throw new PathPolicyError(`invalid local file URL: ${candidate}`);
    }
    if (url.protocol !== "file:" || (url.hostname && url.hostname !== "localhost")) {
      throw new PathPolicyError(`invalid local file URL: ${candidate}`);
    }
    try {
      return decodeURIComponent(url.pathname);
    } catch {
      throw new PathPolicyError(`invalid encoded file URL: ${candidate}`);
    }
  }
  if (/^(?:\/|\.|~)/.test(candidate)) return candidate;
  if (tool === "soffice" && candidate.startsWith("pdf:")) return null;
  if (!candidate.startsWith("-") && !/^-?\d+(?:\.\d+)?$/.test(candidate)) {
    if (extname(candidate)) return candidate;
  }
  return null;
}

export function validateCommandPaths(
  tool: PlanTool,
  command: string[],
  inputPaths: unknown,
  outputPath: string,
): ValidatedPaths {
  if (!Array.isArray(inputPaths) || !inputPaths.every((path) => typeof path === "string")) {
    throw new PathPolicyError("input paths must be an array of absolute path strings");
  }
  const inputs = inputPaths.map(validateInput);
  const output = validateOutput(outputPath);
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
    if (!allowed.has(normalized)) {
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
  if (!outputSeen && !sofficeOutdir) {
    throw new PathPolicyError("command does not reference the granted output path");
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
