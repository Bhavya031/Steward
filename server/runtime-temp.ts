import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const TEMP_DIR_SLOT = "{{temp_dir}}";

export interface RuntimeCommands {
  commands: string[][];
  directory: string | null;
  cleanup: () => void;
}

function validateSlot(argument: string): void {
  if (!argument.includes(TEMP_DIR_SLOT)) return;
  const direct = argument.startsWith(`${TEMP_DIR_SLOT}/`);
  const option = argument.includes(`=${TEMP_DIR_SLOT}/`);
  if (!direct && !option) {
    throw new Error(`${TEMP_DIR_SLOT} must name a child of the managed temp directory`);
  }
}

export function materializeRuntimeCommands(commands: string[][]): RuntimeCommands {
  const usesTemp = commands.some((command) =>
    command.some((argument) => argument.includes(TEMP_DIR_SLOT))
  );
  commands.flat().forEach(validateSlot);
  if (!usesTemp) {
    return { commands: commands.map((command) => [...command]), directory: null, cleanup: () => undefined };
  }
  const directory = mkdtempSync(join(tmpdir(), "steward-run-"));
  return {
    commands: commands.map((command) =>
      command.map((argument) => argument.split(TEMP_DIR_SLOT).join(directory))
    ),
    directory,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}
