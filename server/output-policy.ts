import { constants, accessSync, lstatSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { requireAbsolute } from "./command-path.ts";
import { PathPolicyError } from "./path-error.ts";

function contains(directory: string, candidate: string): boolean {
  const child = relative(directory, candidate);
  return child === "" || (!child.startsWith("..") && !child.startsWith("/"));
}

export function validateOutput(
  path: string,
  permittedRoots: string[],
  rootLabel = "input directory and Steward temp root",
): { raw: string; real: string; rawDirectory: string; realDirectory: string } {
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
    throw new PathPolicyError(`output path is outside the ${rootLabel}`);
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
