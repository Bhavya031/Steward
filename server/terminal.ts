import type { ExecutionEvent } from "./execution-types.ts";
import type { Plan } from "./plan.ts";
import type { Recipe } from "./recipe-types.ts";
import type { VerificationResult } from "./verify/index.ts";

function displayArgv(argv: string[]): string {
  return argv.map((argument) => /^[a-zA-Z0-9_./:=+-]+$/.test(argument)
    ? argument
    : JSON.stringify(argument)).join(" ");
}

export function executionReporter(): (event: ExecutionEvent) => void {
  let progressShown = false;
  return (event) => {
    if (event.type === "started") console.log(`Command: ${displayArgv(event.argv)}`);
    if (event.type === "stderr" && /(?:frame|time|size)=/.test(event.chunk)) {
      const progress = event.chunk.trim().split(/\r?\n|\r/)
        .filter((line) => /(?:frame|time|size)=/.test(line)).at(-1);
      if (progress) {
        process.stderr.write(`${progressShown ? "\r" : ""}Progress: ${progress.slice(0, 180)}`);
        progressShown = true;
      }
    }
    if (event.type === "completed" && progressShown) process.stderr.write("\n");
  };
}

export function printChecks(checks: VerificationResult[]): void {
  console.log("Checks:");
  for (const check of checks) {
    console.log(`  ${check.pass ? "✓" : "✗"} ${check.name}`);
    console.log(`    expected: ${check.expected}`);
    console.log(`    actual:   ${check.actual}`);
  }
}

export function printRecipeCard(
  recipe: Recipe,
  plan: Plan,
  checks: VerificationResult[],
  saved: boolean,
): void {
  const price = `$${recipe.monthly_price}/mo`;
  const struck = process.stdout.isTTY ? `\u001b[9m${price}\u001b[29m` : `~~${price}~~`;
  console.log("\n┌─ STEWARD RECIPE");
  console.log(`│ ${recipe.name}`);
  console.log(`│ ${displayArgv(plan.command)}`);
  console.log(`│ Replaces ${recipe.replaced_service}: ${struck}`);
  console.log(`│ ${saved ? "Saved permanently" : "Re-ran locally"} · model calls: ${saved ? "planning complete" : "0"}`);
  console.log("└─ your computer already knows how.\n");
  printChecks(checks);
}
