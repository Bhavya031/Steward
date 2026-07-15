import { isAbsolute, resolve } from "node:path";
import type { PlanTool } from "./plan.ts";
import { PathPolicyError } from "./path-error.ts";

export function requireAbsolute(path: string, label: string): string {
  if (!path || path.includes("\0") || !isAbsolute(path)) {
    throw new PathPolicyError(`${label} must be an absolute path without NUL bytes`);
  }
  return resolve(path);
}

export function candidateFromArgument(tool: PlanTool, argument: string): string | null {
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
    if (candidate.includes(".")) return candidate;
  }
  return null;
}
