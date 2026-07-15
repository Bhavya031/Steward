export type InstallWeight = "light" | "heavy";

export const TOOL_POLICIES = {
  ffmpeg: { install_weight: "light", install_argv: ["brew", "install", "ffmpeg"] },
  ffprobe: { install_weight: "light", install_argv: ["brew", "install", "ffmpeg"] },
  pandoc: { install_weight: "light", install_argv: ["brew", "install", "pandoc"] },
  magick: { install_weight: "light", install_argv: ["brew", "install", "imagemagick"] },
  ocrmypdf: { install_weight: "light", install_argv: ["brew", "install", "ocrmypdf"] },
  "whisper-cli": { install_weight: "heavy", install_argv: ["brew", "install", "whisper-cpp"] },
  gs: { install_weight: "light", install_argv: ["brew", "install", "ghostscript"] },
  soffice: { install_weight: "heavy", install_argv: ["brew", "install", "--cask", "libreoffice"] },
  brew: { install_weight: "light", install_argv: null },
} as const satisfies Record<
  string,
  { install_weight: InstallWeight; install_argv: readonly string[] | null }
>;

export type AllowedBinary = keyof typeof TOOL_POLICIES;

export const ALLOWED_BINARIES = Object.freeze(
  Object.keys(TOOL_POLICIES) as AllowedBinary[],
);

export function installWeightFor(binary: AllowedBinary): InstallWeight {
  return TOOL_POLICIES[binary].install_weight;
}
