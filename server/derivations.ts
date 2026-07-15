export interface SizeTargetVideoBitrate {
  name: "size_target_video_bitrate";
  args: {
    target_bytes: number;
    audio_kbps: number;
    safety_factor: number;
  };
}

export type Derivation = SizeTargetVideoBitrate;
export type Derivations = Record<string, Derivation>;

export const DERIVATION_GUIDE = `Named derivations (optional):
- A derivations object maps each non-path command {{slot}} to a declared calculation.
- Available name: size_target_video_bitrate.
- size_target_video_bitrate runtime input: duration_s from ffprobe on the first input file.
- Required args: target_bytes (positive integer), audio_kbps (positive number), safety_factor (>0 and <=1).
- Formula: floor((target_bytes * 8 * safety_factor / duration_s / 1000) - audio_kbps).
- Return: an ffmpeg bitrate string such as 1200k.
- Use it only when a command needs a per-file video bitrate from a byte limit; otherwise omit derivations.
- Example: "derivations":{"video_bitrate_kbps":{"name":"size_target_video_bitrate","args":{"target_bytes":25000000,"audio_kbps":96,"safety_factor":0.94}}}.
Code runs only the derivation name and exact args declared here; it never chooses or fills them.`;

export class DerivationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DerivationValidationError";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function validateDerivations(value: unknown): Derivations {
  if (!record(value) || Object.keys(value).length === 0) {
    throw new DerivationValidationError("derivations must be a non-empty object when present");
  }
  const result: Derivations = {};
  for (const [slot, untrusted] of Object.entries(value)) {
    if (!/^[a-z][a-z0-9_]*$/.test(slot)) {
      throw new DerivationValidationError(`derivation slot is invalid: ${slot}`);
    }
    if (!record(untrusted) || !exactKeys(untrusted, ["name", "args"])) {
      throw new DerivationValidationError(`derivation ${slot} must contain only name and args`);
    }
    if (untrusted.name !== "size_target_video_bitrate") {
      throw new DerivationValidationError(`unknown derivation name: ${String(untrusted.name)}`);
    }
    if (!record(untrusted.args) ||
        !exactKeys(untrusted.args, ["target_bytes", "audio_kbps", "safety_factor"])) {
      throw new DerivationValidationError(`derivation ${slot} has invalid args`);
    }
    const { target_bytes, audio_kbps, safety_factor } = untrusted.args;
    if (!Number.isSafeInteger(target_bytes) || (target_bytes as number) <= 0 ||
        !positive(audio_kbps) || !positive(safety_factor) || safety_factor > 1) {
      throw new DerivationValidationError(`derivation ${slot} args are outside their allowed ranges`);
    }
    result[slot] = {
      name: "size_target_video_bitrate",
      args: { target_bytes: target_bytes as number, audio_kbps, safety_factor },
    };
  }
  return result;
}

const SLOT = /\{\{([a-z][a-z0-9_]*)\}\}/g;

export function validateCommandSlots(
  commands: string[][],
  derivations: Derivations | undefined,
  isPathSlot: (slot: string) => boolean,
): void {
  const used = new Set<string>();
  for (const argument of commands.flat()) {
    for (const match of argument.matchAll(SLOT)) used.add(match[1]!);
    if (argument.replace(SLOT, "").includes("{{") || argument.replace(SLOT, "").includes("}}")) {
      throw new DerivationValidationError(`command contains a malformed slot: ${argument}`);
    }
  }
  for (const slot of used) {
    if (!isPathSlot(slot) && !derivations?.[slot]) {
      throw new DerivationValidationError(`command slot requires a declared derivation: ${slot}`);
    }
  }
  for (const slot of Object.keys(derivations ?? {})) {
    if (isPathSlot(slot)) throw new DerivationValidationError(`derivation cannot replace path slot: ${slot}`);
    if (!used.has(slot)) throw new DerivationValidationError(`declared derivation is unused: ${slot}`);
  }
}

export function resolveDerivation(spec: Derivation, durationS: number): string {
  if (!positive(durationS)) throw new Error("derivation duration_s must be positive");
  switch (spec.name) {
    case "size_target_video_bitrate": {
      const { target_bytes, audio_kbps, safety_factor } = spec.args;
      const kbps = Math.floor(target_bytes * 8 * safety_factor / durationS / 1_000 - audio_kbps);
      if (kbps < 32) throw new Error("derived video bitrate is below the safe 32 kbps minimum");
      return `${kbps}k`;
    }
  }
}
