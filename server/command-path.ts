import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { PathPolicyError } from "./path-error.ts";

export function requireAbsolute(path: string, label: string): string {
  if (!path || path.includes("\0") || !isAbsolute(path)) {
    throw new PathPolicyError(`${label} must be an absolute path without NUL bytes`);
  }
  return resolve(path);
}

export function commandAliases(path: string, role: string): string[] {
  const raw = requireAbsolute(path, `${role} path`);
  try {
    const real = existsSync(raw)
      ? realpathSync(raw)
      : join(realpathSync(dirname(raw)), basename(raw));
    return raw === real ? [raw] : [raw, real];
  } catch {
    throw new PathPolicyError(`${role} path parent does not exist: ${path}`);
  }
}
