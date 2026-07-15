import { constants, accessSync } from "node:fs";
import { totalmem } from "node:os";
import { delimiter, join } from "node:path";
import { installWeightFor, type AllowedBinary, type InstallWeight } from "./tools.ts";
type ProbedBinary = Exclude<AllowedBinary, "brew">;

export interface ToolStatus {
  name: ProbedBinary;
  installed: boolean;
  install_weight: InstallWeight;
  binary: string | null;
  version: string | null;
}

export interface BrewStatus {
  name: "brew";
  installed: boolean;
  install_weight: InstallWeight;
  binary: string | null;
  version: string | null;
  expectedPrefix: "/opt/homebrew" | "/usr/local";
  actualPrefix: string | null;
}

export interface SystemProfile {
  platform: NodeJS.Platform;
  macosVersion: string;
  architecture: string;
  ram: { bytes: number; gib: number };
  brew: BrewStatus;
  tools: ToolStatus[];
}

interface ToolDefinition {
  name: ProbedBinary;
  binaries: string[];
  versionArgs: string[] | null;
  brewFormula?: string;
}

const TOOL_DEFINITIONS: ToolDefinition[] = [
  { name: "ffmpeg", binaries: ["ffmpeg"], versionArgs: ["-version"] },
  { name: "ffprobe", binaries: ["ffprobe"], versionArgs: ["-version"] },
  { name: "pandoc", binaries: ["pandoc"], versionArgs: ["--version"] },
  { name: "magick", binaries: ["magick"], versionArgs: ["--version"] },
  { name: "ocrmypdf", binaries: ["ocrmypdf"], versionArgs: ["--version"] },
  {
    name: "whisper-cli",
    binaries: ["whisper-cli", "whisper-cpp"],
    versionArgs: null,
    brewFormula: "whisper-cpp",
  },
  { name: "gs", binaries: ["gs"], versionArgs: ["--version"] },
  { name: "soffice", binaries: ["soffice"], versionArgs: ["--version"] },
];

function runFixed(argv: string[]): string | null {
  try {
    const result = Bun.spawnSync(argv, {
      stdout: "pipe",
      stderr: "pipe",
      timeout: 5_000,
    });
    if (result.exitCode !== 0) return null;
    const output = `${result.stdout.toString()}\n${result.stderr.toString()}`.trim();
    return output.split(/\r?\n/).find((line) => line.trim())?.trim() ?? null;
  } catch {
    return null;
  }
}

function executableAt(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function searchDirectories(expectedBrewPrefix: string): string[] {
  const fromPath = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  return [
    "/Applications/LibreOffice.app/Contents/MacOS",
    join(expectedBrewPrefix, "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    ...fromPath,
  ].filter((directory, index, all) => all.indexOf(directory) === index);
}

function findBinary(names: string[], directories: string[]): string | null {
  for (const name of names) {
    for (const directory of directories) {
      const candidate = join(directory, name);
      if (executableAt(candidate)) return candidate;
    }
  }
  return null;
}

function probeTool(
  definition: ToolDefinition,
  directories: string[],
  brewBinary: string | null,
): ToolStatus {
  const binary = findBinary(definition.binaries, directories);
  const formulaVersion =
    binary && definition.brewFormula && brewBinary
      ? runFixed([brewBinary, "list", "--versions", definition.brewFormula])
      : null;
  return {
    name: definition.name,
    installed: binary !== null,
    install_weight: installWeightFor(definition.name),
    binary,
    version:
      formulaVersion ??
      (binary && definition.versionArgs
        ? runFixed([binary, ...definition.versionArgs])
        : null),
  };
}

export function probeSystem(): SystemProfile {
  const architecture = runFixed(["/usr/bin/uname", "-m"]) ?? process.arch;
  const expectedPrefix = architecture === "arm64" ? "/opt/homebrew" : "/usr/local";
  const directories = searchDirectories(expectedPrefix);
  const brewBinary = findBinary(["brew"], directories);
  const ramBytes = totalmem();

  return {
    platform: process.platform,
    macosVersion: runFixed(["/usr/bin/sw_vers", "-productVersion"]) ?? "unknown",
    architecture,
    ram: { bytes: ramBytes, gib: Number((ramBytes / 1024 ** 3).toFixed(1)) },
    brew: {
      name: "brew",
      installed: brewBinary !== null,
      install_weight: installWeightFor("brew"),
      binary: brewBinary,
      version: brewBinary ? runFixed([brewBinary, "--version"]) : null,
      expectedPrefix,
      actualPrefix: brewBinary ? runFixed([brewBinary, "--prefix"]) : null,
    },
    tools: TOOL_DEFINITIONS.map((tool) => probeTool(tool, directories, brewBinary)),
  };
}

if (import.meta.main) console.log(JSON.stringify(probeSystem(), null, 2));
