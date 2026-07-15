import { relative, resolve } from "node:path";
import { ExecutionError } from "./execution-types.ts";

function passlogPath(command: string[]): string | null {
  const index = command.indexOf("-passlogfile");
  if (index >= 0) return command[index + 1] ?? null;
  const option = command.find((argument) => argument.startsWith("-passlogfile="));
  return option?.slice("-passlogfile=".length) ?? null;
}

function inside(directory: string, path: string): boolean {
  const child = relative(resolve(directory), resolve(path));
  return child !== "" && !child.startsWith("..") && !child.startsWith("/");
}

export function enforceManagedPasslogs(
  commands: string[][],
  temporaryDirectory: string | null,
): void {
  for (const command of commands) {
    const usesPass = command.includes("-pass") || command.some((arg) => arg.startsWith("-pass="));
    if (!usesPass) continue;
    const passlog = passlogPath(command);
    if (!temporaryDirectory || !passlog || !inside(temporaryDirectory, passlog)) {
      throw new ExecutionError("multi-pass commands require -passlogfile inside {{temp_dir}}");
    }
  }
}
