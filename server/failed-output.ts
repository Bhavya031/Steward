import { existsSync, lstatSync, rmSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export function discardFailedOutput(outputPath: string, inputPaths: string[]): void {
  if (!isAbsolute(outputPath) || outputPath.includes("\0")) {
    throw new Error("refusing to discard a non-absolute failed output path");
  }
  const output = resolve(outputPath);
  if (inputPaths.some((input) => resolve(input) === output)) {
    throw new Error("refusing to discard an input path");
  }
  if (!existsSync(output)) return;
  const status = lstatSync(output);
  if (status.isSymbolicLink() || !status.isFile()) {
    throw new Error("refusing to discard a failed output that is not a regular file");
  }
  rmSync(output);
}
