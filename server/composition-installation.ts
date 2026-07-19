import { executeInstall, type ExecutionEvent, type ExecutionResult } from "./executor.ts";
import type { ExecutionOptions } from "./execution-types.ts";
import type { PlanTool } from "./plan.ts";
import { probeSystem, type SystemProfile } from "./probe.ts";
import type { CompositionRecipe } from "./recipe-types.ts";
import { isAtomicRecipe, validateSavedRecipe } from "./recipe-validation.ts";
import { requirementMetadata } from "./installation-runtime.ts";
import {
  installResource, resourceSlots, type ResourceProgress, type TrustedResourceId,
} from "./trusted-resources.ts";
import { TOOL_POLICIES } from "./tools.ts";

export interface CompositionToolRequirement {
  tool: PlanTool;
  provides: PlanTool[];
  command: string[];
}

export interface CompositionRequirements {
  tools: CompositionToolRequirement[];
  resources: TrustedResourceId[];
}

export interface CompositionInstallationDependencies {
  executeTool: (
    tool: PlanTool, command: string[], profile: SystemProfile, confirmed: true,
    options: ExecutionOptions,
  ) => Promise<ExecutionResult>;
  installResource: (
    id: TrustedResourceId,
    onProgress?: (progress: ResourceProgress) => void,
    signal?: AbortSignal,
  ) => Promise<string>;
  probe: () => SystemProfile;
  missingResources: (ids: TrustedResourceId[]) => Promise<TrustedResourceId[]>;
}

const DEFAULT_DEPENDENCIES: CompositionInstallationDependencies = {
  executeTool: executeInstall,
  installResource: (id, onProgress, signal) =>
    installResource(id, onProgress, undefined, signal),
  probe: probeSystem,
  missingResources: async (ids) => (await resourceSlots(ids)).missing,
};

function trustedComposition(value: unknown): CompositionRecipe {
  const saved = validateSavedRecipe(value);
  if (isAtomicRecipe(saved)) throw new Error("composition installation requires a composition");
  return saved;
}

export async function compositionRequirements(
  value: unknown,
  profile: SystemProfile,
  dependencies: CompositionInstallationDependencies = DEFAULT_DEPENDENCIES,
): Promise<CompositionRequirements> {
  const composition = trustedComposition(value);
  const declared = composition.stages.flatMap((stage) =>
    [stage.tool, ...stage.command_template.commands.map((command) => command[0] as PlanTool)]
  ).filter((tool, index, all) => all.indexOf(tool) === index);
  const missing = declared.filter((tool) =>
    !profile.tools.find((status) => status.name === tool)?.installed
  );
  const grouped = new Map<string, CompositionToolRequirement>();
  for (const tool of missing) {
    const policy = TOOL_POLICIES[tool].install_argv;
    if (!policy) throw new Error(`${tool} has no installation policy`);
    const command = [...policy];
    const key = JSON.stringify(command);
    const existing = grouped.get(key);
    if (existing) existing.provides.push(tool);
    else grouped.set(key, { tool, provides: [tool], command });
  }
  const resources = composition.stages.flatMap((stage) => stage.resources ?? [])
    .filter((id, index, all) => all.indexOf(id) === index);
  return {
    tools: [...grouped.values()],
    resources: await dependencies.missingResources(resources),
  };
}

export function compositionRequirementsNeeded(
  requirements: CompositionRequirements,
): boolean {
  return requirements.tools.length > 0 || requirements.resources.length > 0;
}

export function compositionRequirementMetadata(requirements: CompositionRequirements) {
  return {
    tools: requirements.tools.map(({ provides, command }) => ({
      tools: [...provides], command: [...command],
    })),
    resources: requirementMetadata({
      tool: null, command: null, resources: requirements.resources,
    }),
  };
}

export async function installCompositionRequirements(
  profile: SystemProfile,
  requirements: CompositionRequirements,
  callbacks: {
    onToolEvent?: (event: ExecutionEvent) => void;
    onResourceProgress?: (progress: ResourceProgress) => void;
    signal?: AbortSignal;
  } = {},
  dependencies: CompositionInstallationDependencies = DEFAULT_DEPENDENCIES,
): Promise<SystemProfile> {
  let current = profile;
  for (const requirement of requirements.tools) {
    callbacks.signal?.throwIfAborted();
    const result = await dependencies.executeTool(
      requirement.tool, requirement.command, current, true,
      { onEvent: callbacks.onToolEvent, signal: callbacks.signal },
    );
    if (!result.ok) throw new Error(`tool installation failed with exit ${result.exit_code}`);
    current = dependencies.probe();
    for (const tool of requirement.provides) {
      if (!current.tools.find((status) => status.name === tool)?.installed) {
        throw new Error(`${tool} is still unavailable after installation`);
      }
    }
  }
  for (const id of requirements.resources) {
    callbacks.signal?.throwIfAborted();
    await dependencies.installResource(id, callbacks.onResourceProgress, callbacks.signal);
  }
  return current;
}
