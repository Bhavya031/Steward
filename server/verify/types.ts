import type { SystemProfile } from "../probe.ts";

export interface VerificationResult {
  name: string;
  pass: boolean;
  expected: string;
  actual: string;
}

export interface VerificationContext {
  outputPath: string;
  sourcePaths: string[];
  profile: SystemProfile;
}
