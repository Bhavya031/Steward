import { constants, accessSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { Plan } from "./plan.ts";
import { probeSystem, type SystemProfile } from "./probe.ts";
import { runWithRepair } from "./repair-loop.ts";
import { match, rerun, save, type Recipe } from "./recipes.ts";
import { executionReporter, printAttemptEvent, printChecks, printRecipeCard } from "./terminal.ts";

interface RecipeIdentity {
  name: string;
  replaced_service: string;
  monthly_price: number;
}

function filesFrom(argv: string[]): string[] {
  if (argv.length === 0) throw new Error("usage: bun run server/index.ts \"<task>\" <file> [file...]");
  return argv.map((file) => {
    const path = resolve(file);
    try {
      if (!statSync(path).isFile()) throw new Error("not a file");
      accessSync(path, constants.R_OK);
    } catch {
      throw new Error(`input is not a readable file: ${file}`);
    }
    return path;
  });
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
}

function identityFor(task: string, plan: Plan): RecipeIdentity {
  const sizeCheck = plan.checks.find((check) => check.type === "size_under");
  const statedLimit = task.toLowerCase().match(/(\d+(?:\.\d+)?)\s*(kb|mb|gb)\b/);
  if (sizeCheck) {
    const limit = statedLimit ? `${statedLimit[1]}${statedLimit[2]}` : "target-size";
    return {
      name: `compress-video-under-${slug(limit)}`,
      replaced_service: "Video compressor SaaS",
      monthly_price: 12,
    };
  }
  return {
    name: slug(task) || `${plan.tool}-recipe`,
    replaced_service: "Single-purpose file SaaS",
    monthly_price: 10,
  };
}

function printSystem(profile: SystemProfile): void {
  console.log(`System: macOS ${profile.macosVersion} · ${profile.architecture} · ${profile.ram.gib} GiB`);
}

async function runMatched(recipe: Recipe, confidence: number, files: string[]): Promise<void> {
  console.log(`Recipe exists: ${recipe.name} (${Math.round(confidence * 100)}% local match)`);
  console.log("Mode: saved recipe · model calls: 0");
  const run = await rerun(recipe, files, { executionOptions: { onEvent: executionReporter() } });
  printRecipeCard(recipe, run.plan, run.checks, false);
  if (!run.all_pass) throw new Error(`recipe rerun failed (exit ${run.execution.exit_code})`);
}

async function runPlanned(task: string, files: string[]): Promise<void> {
  console.log("No local recipe matched.");
  const profile = probeSystem();
  printSystem(profile);
  console.log("Mode: GPT-5.6 planning");
  const { planTask, repairTask } = await import("./agent.ts");
  const planningTask = `${task}\nInput files (absolute paths): ${JSON.stringify(files)}`;
  const initialPlan = await planTask(profile, planningTask);
  if (initialPlan.install_cmd) {
    throw new Error(`install requires confirmation before execution: ${JSON.stringify(initialPlan.install_cmd)}`);
  }
  const run = await runWithRepair({
    initialPlan,
    profile,
    inputPaths: files,
    executionOptions: { onEvent: executionReporter() },
    onAttempt: printAttemptEvent,
    repair: (context) => repairTask(profile, context),
  });
  if (!run.all_pass) {
    printChecks(run.checks);
    if (!run.execution.ok) console.error(`Executor stderr: ${run.execution.stderr_tail}`);
    throw new Error(`all ${run.events.length} attempts failed; recipe was not saved`);
  }
  const identity = identityFor(task, run.plan);
  const recipe = save({
    ...identity,
    plan: run.plan,
    inputPaths: files,
    verification: run.checks,
    arch: profile.architecture,
  });
  if (!recipe) throw new Error("green verification was refused by recipe storage");
  printRecipeCard(recipe, run.plan, run.checks, true);
  console.log(`Saved: recipes/${recipe.name}.json`);
}

export async function main(argv = Bun.argv.slice(2)): Promise<void> {
  const [task, ...rawFiles] = argv;
  if (!task?.trim()) throw new Error("task description is required");
  const files = filesFrom(rawFiles);
  console.log("STEWARD · your computer already knows how.");
  const localMatch = match(task, files);
  if (localMatch) return runMatched(localMatch.recipe, localMatch.confidence, files);
  return runPlanned(task, files);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`Steward failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
