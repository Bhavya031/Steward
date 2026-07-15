export type InstallWeight = "light" | "heavy";

export const TOOL_POLICIES = {
  ffmpeg: { install_weight: "light" },
  ffprobe: { install_weight: "light" },
  pandoc: { install_weight: "light" },
  magick: { install_weight: "light" },
  ocrmypdf: { install_weight: "light" },
  "whisper-cli": { install_weight: "heavy" },
  gs: { install_weight: "light" },
  soffice: { install_weight: "heavy" },
  brew: { install_weight: "light" },
} as const satisfies Record<string, { install_weight: InstallWeight }>;

export type AllowedBinary = keyof typeof TOOL_POLICIES;

export const ALLOWED_BINARIES = Object.freeze(
  Object.keys(TOOL_POLICIES) as AllowedBinary[],
);

export function installWeightFor(binary: AllowedBinary): InstallWeight {
  return TOOL_POLICIES[binary].install_weight;
}
