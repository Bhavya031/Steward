import { executeFfprobe } from "./executor.ts";
import { resolveDerivation, type Derivations } from "./derivations.ts";
import type { Plan } from "./plan.ts";
import type { SystemProfile } from "./probe.ts";

function durationFrom(raw: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("cannot resolve derivation: ffprobe returned invalid JSON");
  }
  const format = typeof parsed === "object" && parsed !== null && "format" in parsed
    ? (parsed as { format?: unknown }).format : null;
  const value = typeof format === "object" && format !== null && "duration" in format
    ? (format as { duration?: unknown }).duration : null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error("cannot resolve derivation: first input duration is unavailable");
  }
  return seconds;
}

export async function resolveDerivationSlots(
  derivations: Derivations | undefined,
  files: string[],
  profile: SystemProfile,
): Promise<Record<string, string>> {
  if (!derivations || Object.keys(derivations).length === 0) return {};
  if (!files[0]) throw new Error("cannot resolve derivation without a first input file");
  const probe = await executeFfprobe("duration", files[0], profile);
  if (!probe.ok) throw new Error(`cannot resolve derivation: ${probe.stderr_tail}`);
  const duration = durationFrom(probe.stdout_tail);
  return Object.fromEntries(Object.entries(derivations).map(([slot, spec]) =>
    [slot, resolveDerivation(spec, duration)]
  ));
}

function fill(value: string, slots: Record<string, string>): string {
  return value.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, (match, slot: string) => slots[slot] ?? match);
}

export async function materializePlanDerivations(
  plan: Plan,
  files: string[],
  profile: SystemProfile,
): Promise<Plan> {
  const slots = await resolveDerivationSlots(plan.derivations, files, profile);
  const { derivations: _declarations, ...authored } = plan;
  return {
    ...authored,
    commands: plan.commands.map((command) => command.map((argument) => fill(argument, slots))),
  };
}
