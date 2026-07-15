import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { Plan } from "./plan.ts";
import { load, match, renderRecipe, save } from "./recipes.ts";
import type { SaveRecipeInput } from "./recipe-types.ts";
import type { VerificationResult } from "./verify/index.ts";

const root = mkdtempSync(join(tmpdir(), "steward-recipes-"));
const source = join(root, "original.mp4");
const output = join(root, "original-compressed.mp4");
writeFileSync(source, "fixture");

afterAll(() => rmSync(root, { recursive: true, force: true }));

function plan(): Plan {
  return {
    tool: "ffmpeg",
    install_cmd: null,
    command: ["ffmpeg", "-i", source, "-c:v", "libx264", output],
    output_path: output,
    checks: [
      { type: "size_under", target: 25_000_000 },
      { type: "duration_matches", target: source },
      { type: "streams_present", target: "video,audio" },
      { type: "plays", target: true },
    ],
  };
}

function evidence(pass = true): VerificationResult[] {
  return plan().checks.map((check) => ({
    name: check.type,
    pass,
    expected: "expected evidence",
    actual: "measured evidence",
  }));
}

function input(verification = evidence()): SaveRecipeInput {
  return {
    name: "compress-video-under-25mb",
    replaced_service: "Video compressor SaaS",
    monthly_price: 12,
    plan: plan(),
    inputPaths: [source],
    verification,
    arch: "arm64",
    createdAt: "2026-07-15T00:00:00.000Z",
  };
}

describe("recipes", () => {
  test("saves only when every planned check is green", () => {
    const failedDirectory = join(root, "failed");
    const failed = evidence();
    failed[2] = { ...failed[2]!, pass: false, actual: "audio missing" };
    expect(save(input(failed), failedDirectory)).toBeNull();
    expect(existsSync(failedDirectory)).toBe(false);

    const savedDirectory = join(root, "saved");
    const saved = save(input(), savedDirectory);
    expect(saved?.name).toBe("compress-video-under-25mb");
    expect(load(savedDirectory)).toEqual([saved!]);
    const json = JSON.parse(readFileSync(join(savedDirectory, `${saved?.name}.json`), "utf8"));
    expect(Object.keys(json).sort()).toEqual([
      "arch", "checks", "command_template", "created_at", "install_weight",
      "monthly_price", "name", "replaced_service", "tool",
    ]);
  });

  test("fills command, output, and check slots for a new input", () => {
    const recipe = save(input(), join(root, "slots"));
    if (!recipe) throw new Error("green recipe did not save");
    const second = join(root, "second clip.mp4");
    const rendered = renderRecipe(recipe, [second]);
    expect(rendered.command).toEqual([
      "ffmpeg", "-i", second, "-c:v", "libx264", join(root, "second clip-compressed.mp4"),
    ]);
    expect(rendered.output_path).toBe(join(root, "second clip-compressed.mp4"));
    expect(rendered.checks[1]?.target).toBe(second);
    expect(JSON.stringify(recipe)).not.toContain(source);
  });

  test("matches a paraphrased task locally", () => {
    const directory = join(root, "match");
    save(input(), directory);
    const found = match("shrink this movie to less than 25 MB", [join(root, "new.mp4")], directory);
    expect(found?.recipe.name).toBe("compress-video-under-25mb");
    expect(found?.confidence).toBeGreaterThan(0.8);
  });

  test("rerun's complete module graph excludes agent.ts", () => {
    const entry = resolve(import.meta.dir, "recipes.ts");
    const visited = new Set<string>();
    const visit = (file: string): void => {
      if (visited.has(file)) return;
      visited.add(file);
      const sourceText = readFileSync(file, "utf8");
      const imports = [
        ...sourceText.matchAll(/\bfrom\s+["'](\.[^"']+)["']/g),
        ...sourceText.matchAll(/\bimport\s*\(\s*["'](\.[^"']+)["']\s*\)/g),
        ...sourceText.matchAll(/\bimport\s+["'](\.[^"']+)["']/g),
      ];
      for (const found of imports) {
        const dependency = resolve(dirname(file), found[1]!);
        if (dependency.endsWith(".ts") && existsSync(dependency)) visit(dependency);
      }
    };
    visit(entry);
    const modules = [...visited].map((path) => basename(path));
    expect(modules).toContain("executor.ts");
    expect(modules).toContain("index.ts");
    expect(modules).not.toContain("agent.ts");
  });
});
