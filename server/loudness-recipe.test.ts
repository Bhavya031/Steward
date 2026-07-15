import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecutionEvent } from "./executor.ts";
import type { Plan } from "./plan.ts";
import { probeSystem } from "./probe.ts";
import { rerun, save } from "./recipes.ts";
import { writeWav } from "./test-fixtures.ts";

const root = mkdtempSync(join(tmpdir(), "steward-loudness-recipe-"));
const quiet = join(root, "quiet.wav");
const loud = join(root, "loud.wav");
const output = join(root, "quiet-normalized.wav");
writeWav(quiet, 2, { frequency: 330, amplitude: 0.06 });
writeWav(loud, 3, { frequency: 710, amplitude: 0.45, channels: 2 });
afterAll(() => rmSync(root, { recursive: true, force: true }));

function plannedNormalization(): Plan {
  return {
    tool: "ffmpeg", install_cmd: null,
    commands: [["ffmpeg", "-i", quiet, "-af", "loudnorm=I=-14:TP=-1:LRA=11", output]],
    output_path: output,
    checks: [
      { type: "audio_stream_present", target: true },
      { type: "loudness_matches", target: -14 },
      { type: "true_peak_under", target: -1 },
      { type: "duration_matches", target: quiet },
    ],
  };
}

describe("two-pass loudness recipe", () => {
  test("re-measures different inputs locally and reruns green without a model", async () => {
    const plan = plannedNormalization();
    const recipe = save({
      name: "normalize-audio-to-14-lufs", replaced_service: "Podcast loudness SaaS",
      monthly_price: 10, plan, inputPaths: [quiet], arch: "arm64",
      verification: plan.checks.map((check) => ({
        name: check.type, pass: true, expected: "fixture", actual: "fixture",
      })),
    }, join(root, "recipes"));
    if (!recipe) throw new Error("loudness recipe did not save");
    expect(JSON.stringify(recipe)).not.toContain(root);
    expect(recipe.command_template.commands[0]).toContain("{{loudnorm_filter}}");

    const profile = probeSystem();
    const events: ExecutionEvent[] = [];
    const first = await rerun(recipe, [quiet], {
      profile, executionOptions: { onEvent: (event) => events.push(event) },
    });
    const second = await rerun(recipe, [loud], { profile });
    expect(first.all_pass).toBe(true);
    expect(second.all_pass).toBe(true);
    expect(first.model_calls).toBe(0);
    expect(second.model_calls).toBe(0);
    const firstFilter = first.plan.commands[0]?.at(-2);
    const secondFilter = second.plan.commands[0]?.at(-2);
    expect(firstFilter).toContain("measured_I=-28");
    expect(secondFilter).toContain("measured_I=-7");
    expect(firstFilter).not.toBe(secondFilter);
    expect(events.filter((event) => event.type === "started")).toHaveLength(2);
  }, 20_000);
});
