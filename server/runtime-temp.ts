import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEMP_DIR_SLOT } from "./intermediate-policy.ts";

export { TEMP_DIR_SLOT } from "./intermediate-policy.ts";

export interface RuntimeCommands {
  commands: string[][];
  intermediates: string[];
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

export function materializeRuntimeCommands(
  commands: string[][],
  intermediates: string[] = [],
): RuntimeCommands {
  const values = [...commands.flat(), ...intermediates];
  const usesTemp = values.some((value) => value.includes(TEMP_DIR_SLOT));
  values.forEach(validateSlot);
  if (!usesTemp) {
    return {
      commands: commands.map((command) => [...command]), intermediates: [],
      directory: null, cleanup: () => undefined,
    };
  }
  const directory = mkdtempSync(join(tmpdir(), "steward-run-"));
  const materialize = (value: string) => value.split(TEMP_DIR_SLOT).join(directory);
  return {
    commands: commands.map((command) => command.map(materialize)),
    intermediates: intermediates.map(materialize),
    directory,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}
