import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plan } from "./plan.ts";
import { probeSystem } from "./probe.ts";
import { runWithRepair } from "./repair-loop.ts";
import { writeY4m } from "./test-fixtures.ts";

const root = mkdtempSync(join(tmpdir(), "steward-repair-policy-"));
const input = join(root, "input.y4m");
const output = join(root, "output.mp4");
const profile = probeSystem();
writeY4m(input, 1, 160, 90);
afterAll(() => rmSync(root, { recursive: true, force: true }));

function plan(extra: string[] = []): Plan {
  return {
    tool: "ffmpeg", install_cmd: null,
    commands: [["ffmpeg", "-loglevel", "error", "-i", input, ...extra,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", output]],
    output_path: output, checks: [
      { type: "duration_matches", target: input },
      { type: "plays", target: true },
    ],
  };
}

describe("repair policy rejection", () => {
  test("preserves measured evidence across a pre-spawn rejection", async () => {
    let repairs = 0;
    const run = await runWithRepair({
      initialPlan: plan(["-t", "0.2"]), profile, inputPaths: [input],
      repair: async (context) => {
        repairs += 1;
        expect(context.failed_checks[0]?.actual).toContain("Δ");
        if (repairs === 1) return plan(["-minrate", "100k"]);
        expect(context.stderr_tail).toContain("flag is not allowed: -minrate");
        return plan();
      },
    });
    expect(repairs).toBe(2);
    expect(run.events.map((event) => event.outcome.status)).toEqual([
      "verification_failed", "execution_failed", "passed",
    ]);
  });

  test("never deletes a pre-existing output after policy rejection", async () => {
    const protectedOutput = join(root, "pre-existing.mp4");
    writeFileSync(protectedOutput, "belongs to user");
    const unsafe = plan(["-minrate", "100k"]);
    unsafe.output_path = protectedOutput;
    unsafe.commands[0]![unsafe.commands[0]!.length - 1] = protectedOutput;
    const run = await runWithRepair({
      initialPlan: unsafe, profile, inputPaths: [input], repair: async () => unsafe,
    });
    expect(run.all_pass).toBe(false);
    expect(readFileSync(protectedOutput, "utf8")).toBe("belongs to user");
  });
});
