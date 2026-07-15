import {
  constants,
  accessSync,
  existsSync,
  realpathSync,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { ExecutionError } from "./execution-types.ts";

export const HELPER_PATHS = {
  ls: "/bin/ls",
  cat: "/bin/cat",
  mkdir: "/bin/mkdir",
  cp: "/bin/cp",
  mv: "/bin/mv",
  stat: "/usr/bin/stat",
  du: "/usr/bin/du",
  head: "/usr/bin/head",
  tail: "/usr/bin/tail",
} as const;

export type HelperTool = keyof typeof HELPER_PATHS;
export interface HelperStep {
  tool: HelperTool;
  command: string[];
}
export interface HelperGrants {
  read: string[];
  write: string[];
}

const HELPERS = new Set(Object.keys(HELPER_PATHS));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function absolutePath(value: unknown, label: string): string {
  if (typeof value !== "string" || value.includes("\0") || !isAbsolute(value)) {
    throw new ExecutionError(`${label} must be an absolute path without NUL bytes`);
  }
  return resolve(value);
}

function canonicalCandidate(path: string): string {
  if (existsSync(path)) return realpathSync(path);
  const parent = dirname(path);
  if (parent === path) throw new ExecutionError(`no existing ancestor for path: ${path}`);
  return resolve(canonicalCandidate(parent), basename(path));
}

function canonicalGrants(value: unknown, mode: "read" | "write"): string[] {
  if (!Array.isArray(value) || !value.every((path) => typeof path === "string")) {
    throw new ExecutionError(`${mode} grants must be arrays of absolute paths`);
  }
  return value.map((path) => {
    const absolute = absolutePath(path, `${mode} grant`);
    let canonical: string;
    try {
      canonical = realpathSync(absolute);
      accessSync(canonical, mode === "read" ? constants.R_OK : constants.W_OK);
    } catch {
      throw new ExecutionError(`${mode} grant is unavailable: ${path}`);
    }
    return canonical;
  });
}

function isWithin(path: string, root: string): boolean {
  const fromRoot = relative(root, path);
  return fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot));
}

function requireGrant(path: string, roots: string[], mode: "read" | "write"): void {
  let canonical: string;
  try {
    canonical = canonicalCandidate(path);
  } catch {
    throw new ExecutionError(`helper ${mode} path is unavailable: ${path}`);
  }
  if (!roots.some((root) => isWithin(canonical, root))) {
    throw new ExecutionError(`helper ${mode} path is outside granted roots: ${path}`);
  }
}

function operandsFor(tool: HelperTool, command: string[]): string[] {
  const args = command.slice(1);
  const operands = tool === "mkdir" && args[0] === "-p" ? args.slice(1) : args;
  if (operands.length === 0) throw new ExecutionError(`${tool} requires a path operand`);
  if (operands.some((argument) => argument.startsWith("-"))) {
    throw new ExecutionError(`${tool} helper options are not permitted`);
  }
  return operands.map((argument) => absolutePath(argument, `${tool} operand`));
}

export function validateHelperStep(
  value: unknown,
  untrustedGrants: unknown,
): HelperStep {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    !("tool" in value) ||
    !("command" in value) ||
    typeof value.tool !== "string" ||
    !HELPERS.has(value.tool) ||
    !Array.isArray(value.command) ||
    !value.command.every((argument) => typeof argument === "string" && !argument.includes("\0"))
  ) {
    throw new ExecutionError("invalid helper step");
  }
  const tool = value.tool as HelperTool;
  if (value.command[0] !== tool) throw new ExecutionError("helper command[0] must match tool");
  if (!isRecord(untrustedGrants)) throw new ExecutionError("helper grants are required");
  const grants = untrustedGrants as unknown as HelperGrants;
  const readRoots = canonicalGrants(grants.read, "read");
  const writeRoots = canonicalGrants(grants.write, "write");
  const operands = operandsFor(tool, value.command);

  if (tool === "cp" || tool === "mv") {
    if (operands.length !== 2) throw new ExecutionError(`${tool} requires one source and destination`);
    requireGrant(operands[0]!, tool === "cp" ? readRoots : writeRoots, tool === "cp" ? "read" : "write");
    requireGrant(operands[1]!, writeRoots, "write");
  } else {
    const mode = tool === "mkdir" ? "write" : "read";
    const roots = mode === "write" ? writeRoots : readRoots;
    for (const operand of operands) requireGrant(operand, roots, mode);
  }
  return { tool, command: [...value.command] };
}
