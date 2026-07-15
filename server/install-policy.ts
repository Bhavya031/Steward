import { ExecutionError } from "./execution-types.ts";
import type { SystemProfile } from "./probe.ts";
import { TOOL_POLICIES, type AllowedBinary } from "./tools.ts";

export type InstallableTool = Exclude<AllowedBinary, "brew">;

export interface ValidatedInstall {
  tool: InstallableTool;
  argv: string[];
}

export function validateInstallProposal(
  untrustedTool: unknown,
  proposedArgv: unknown,
  profile: SystemProfile,
  heavyConfirmed: unknown,
): ValidatedInstall {
  if (
    typeof untrustedTool !== "string" ||
    untrustedTool === "brew" ||
    !Object.hasOwn(TOOL_POLICIES, untrustedTool)
  ) {
    throw new ExecutionError("install tool is not allowlisted");
  }
  const tool = untrustedTool as InstallableTool;
  const expected = TOOL_POLICIES[tool].install_argv;
  if (
    !expected ||
    !Array.isArray(proposedArgv) ||
    !proposedArgv.every((argument) => typeof argument === "string") ||
    proposedArgv.length !== expected.length
  ) {
    throw new ExecutionError(`invalid install proposal for ${tool}`);
  }
  if (!proposedArgv.every((argument, index) => argument === expected[index])) {
    throw new ExecutionError(`install proposal does not match policy for ${tool}`);
  }
  if (TOOL_POLICIES[tool].install_weight === "heavy" && heavyConfirmed !== true) {
    throw new ExecutionError(`${tool} requires explicit heavy-install confirmation`);
  }
  const status = profile.tools.find((candidate) => candidate.name === tool);
  if (!status) throw new ExecutionError(`probe status is missing for ${tool}`);
  if (status.installed) throw new ExecutionError(`${tool} is already installed`);
  return { tool, argv: proposedArgv };
}
