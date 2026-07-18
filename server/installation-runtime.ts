import { executeInstall, type ExecutionEvent } from "./executor.ts";
import type { Plan } from "./plan.ts";
import { probeSystem, type SystemProfile } from "./probe.ts";
import {
  installResource, resourceSlots, TRUSTED_RESOURCES,
  type ResourceProgress, type TrustedResourceId,
} from "./trusted-resources.ts";

export interface PlanRequirements {
  tool: Plan["tool"] | null;
  command: string[] | null;
  resources: TrustedResourceId[];
}

export async function planRequirements(plan: Plan): Promise<PlanRequirements> {
  const missing = (await resourceSlots(plan.resources)).missing;
  return {
    tool: plan.install_cmd ? plan.tool : null,
    command: plan.install_cmd ? [...plan.install_cmd] : null,
    resources: missing,
  };
}

export function requirementMetadata(requirements: PlanRequirements) {
  return requirements.resources.map((id) => ({
    id,
    bytes: TRUSTED_RESOURCES[id].bytes,
    sha256: TRUSTED_RESOURCES[id].sha256,
    source: TRUSTED_RESOURCES[id].source,
  }));
}

export async function installRequirements(
  plan: Plan,
  profile: SystemProfile,
  requirements: PlanRequirements,
  callbacks: {
    onToolEvent?: (event: ExecutionEvent) => void;
    onResourceProgress?: (progress: ResourceProgress) => void;
  } = {},
): Promise<{ plan: Plan; profile: SystemProfile }> {
  let currentProfile = profile;
  if (requirements.tool && requirements.command) {
    const result = await executeInstall(
      requirements.tool, requirements.command, currentProfile, true,
      { onEvent: callbacks.onToolEvent },
    );
    if (!result.ok) throw new Error(`tool installation failed with exit ${result.exit_code}`);
    currentProfile = probeSystem();
    const status = currentProfile.tools.find((tool) => tool.name === requirements.tool);
    if (!status?.installed) throw new Error(`${requirements.tool} is still unavailable after installation`);
  }
  for (const id of requirements.resources) {
    await installResource(id, callbacks.onResourceProgress);
  }
  return {
    plan: { ...plan, install_cmd: null },
    profile: currentProfile,
  };
}
