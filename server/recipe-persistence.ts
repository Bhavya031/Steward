import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function persistRecipe<T extends { name: string }>(recipe: T, directory: string): T {
  mkdirSync(directory, { recursive: true });
  const destination = join(directory, `${recipe.name}.json`);
  const temporary = join(directory, `.${recipe.name}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, `${JSON.stringify(recipe, null, 2)}\n`, { flag: "wx" });
    renameSync(temporary, destination);
  } finally {
    rmSync(temporary, { force: true });
  }
  return recipe;
}
