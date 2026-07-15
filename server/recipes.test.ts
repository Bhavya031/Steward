import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Plan } from "./plan.ts";
import { load, match, renderRecipe, save } from "./recipes.ts";
import type { SaveRecipeInput } from "./recipe-types.ts";
import { relativeSourceGraph } from "./source-graph.ts";
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
    commands: [["ffmpeg", "-i", source, "-c:v", "libx264", output]],
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

  test("fills commands, output, and check slots for a new input", () => {
    const recipe = save(input(), join(root, "slots"));
    if (!recipe) throw new Error("green recipe did not save");
    const second = join(root, "second clip.mp4");
    const rendered = renderRecipe(recipe, [second]);
    expect(rendered.commands).toEqual([[
      "ffmpeg", "-i", second, "-c:v", "libx264", join(root, "second clip-compressed.mp4"),
    ]]);
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

  test("preserves the executor-owned temp slot in multi-command recipes", () => {
    const declared = plan();
    declared.commands = [
      ["ffmpeg", "-i", source, "-b:v", "{{video_bitrate_kbps}}", "-pass", "1",
        "-passlogfile", "{{temp_dir}}/ffmpeg2pass", "-an", "-f", "null", "{{temp_dir}}/pass1.null"],
      ["ffmpeg", "-i", source, "-b:v", "{{video_bitrate_kbps}}", "-pass", "2",
        "-passlogfile", "{{temp_dir}}/ffmpeg2pass", output],
    ];
    declared.derivations = {
      video_bitrate_kbps: {
        name: "size_target_video_bitrate",
        args: { target_bytes: 25_000_000, audio_kbps: 96, safety_factor: 0.94 },
      },
    };
    const recipe = save({ ...input(), plan: declared }, join(root, "declared"));
    if (!recipe) throw new Error("declared recipe did not save");
    const rendered = renderRecipe(recipe, [join(root, "fresh.mp4")], {
      video_bitrate_kbps: "1000k",
    });
    expect(rendered.commands).toHaveLength(2);
    expect(rendered.commands.flat()).toContain("{{temp_dir}}/ffmpeg2pass");
    expect(recipe.derivations).toEqual(declared.derivations);
    const stored = JSON.parse(readFileSync(join(root, "declared", `${recipe.name}.json`), "utf8"));
    expect(stored.derivations).toEqual(declared.derivations);
  });

  test("rerun's resolved module graph cannot reach the model", async () => {
    const entry = resolve(import.meta.dir, "recipes.ts");
    const graph = relativeSourceGraph(entry, resolve(import.meta.dir, ".."));
    const modules = [...graph.keys()].sort();
    expect(modules).toContain("server/executor.ts");
    expect(modules).toContain("server/verify/index.ts");
    expect(modules).not.toContain("server/index.ts");
    expect(modules).not.toContain("server/agent.ts");
    const hazards: string[] = [];
    for (const [module, sourceText] of graph) {
      if (/\bcodex\b/i.test(sourceText)) hazards.push(`${module}: codex reference`);
      if (/node:child_process|\bexecFile(?:Sync)?\b|\bimport(?:\s|\/\*[\s\S]*?\*\/)*\(/.test(sourceText)) {
        hazards.push(`${module}: indirect process or dynamic import`);
      }
      if (/\bBun\.spawn(?:Sync)?\s*\(/.test(sourceText) &&
          module !== "server/executor.ts" && module !== "server/probe.ts") {
        hazards.push(`${module}: unexpected spawn`);
      }
    }
    expect(hazards).toEqual([]);
    const bundle = await Bun.build({ entrypoints: [entry], target: "bun" });
    expect(bundle.success).toBe(true);
    const bundledSource = await bundle.outputs[0]!.text();
    expect(bundledSource).not.toContain("server/agent.ts");
    expect(bundledSource).not.toMatch(/codex\s+exec/i);
    expect(bundledSource).not.toMatch(/gpt-5\.6|codexPath|runCodex|planTask|repairTask/);
  });
});
