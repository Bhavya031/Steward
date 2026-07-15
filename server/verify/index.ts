import type { CheckTarget } from "../plan.ts";
import type { VerificationContext, VerificationResult } from "./types.ts";
import { VIDEO_CHECK_TYPES, verifyVideoCheck, type VideoCheckType } from "./video.ts";

const VIDEO_TYPES = new Set<string>(VIDEO_CHECK_TYPES);

function failure(name: string, expected: string, actual: string): VerificationResult {
  return { name, pass: false, expected, actual };
}

export async function verifyChecks(
  untrustedChecks: unknown,
  context: VerificationContext,
): Promise<VerificationResult[]> {
  if (!Array.isArray(untrustedChecks)) {
    return [failure("checks", "array of registered checks", "checks value is not an array")];
  }
  const results: VerificationResult[] = [];
  for (const check of untrustedChecks) {
    if (typeof check !== "object" || check === null || !("type" in check) || !("target" in check)) {
      results.push(failure("unknown", "registered check with a target", "malformed check"));
      continue;
    }
    const { type, target } = check as { type: unknown; target: unknown };
    if (typeof type !== "string" || !VIDEO_TYPES.has(type)) {
      const name = typeof type === "string" ? type : "unknown";
      results.push(failure(name, "registered verification check", `unsupported check type: ${String(type)}`));
      continue;
    }
    try {
      results.push(await verifyVideoCheck(type as VideoCheckType, target as CheckTarget, context));
    } catch (error) {
      results.push(failure(
        type,
        `check target ${JSON.stringify(target)}`,
        `verification failed: ${error instanceof Error ? error.message : String(error)}`,
      ));
    }
  }
  return results;
}

export type { VerificationContext, VerificationResult } from "./types.ts";
