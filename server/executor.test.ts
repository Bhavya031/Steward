import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ExecutionError,
  executeInstall,
  executePlan,
  type ExecutionEvent,
} from "./executor.ts";
import type { Plan } from "./plan.ts";
import { probeSystem } from "./probe.ts";

const directory = mkdtempSync(join(tmpdir(), "steward-executor-"));
const profile = probeSystem();
let planNumber = 0;

afterAll(() => rmSync(directory, { recursive: true, force: true }));

function generationPlan(): Plan {
  const output = join(directory, `generated-${planNumber++}.mp4`);
  return {
    tool: "ffmpeg",
    install_cmd: null,
    command: [
      "ffmpeg",
      "-f", "lavfi",
      "-i", "testsrc=size=64x64:rate=1",
      "-t", "1",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      output,
    ],
    output_path: output,
    checks: [{ type: "plays", target: true }],
  };
}

describe("executor", () => {
  test("executes an allowlisted argv command and streams progress", async () => {
    const events: ExecutionEvent[] = [];
    const plan = generationPlan();
    const result = await executePlan(plan, profile, [], {
      onEvent: (event) => events.push(event),
    });
    expect(result.ok).toBe(true);
    expect(result.timed_out).toBe(false);
    expect(existsSync(plan.output_path)).toBe(true);
    expect(events.some((event) => event.type === "stderr")).toBe(true);
    expect(events.at(0)?.type).toBe("started");
    expect(events.at(-1)?.type).toBe("completed");
  });

  test("executes only with an exact readable input grant", async () => {
    const sourcePlan = generationPlan();
    expect((await executePlan(sourcePlan, profile, [])).ok).toBe(true);
    const output = join(directory, `copied-${planNumber++}.mp4`);
    const copyPlan: Plan = {
      ...sourcePlan,
      command: ["ffmpeg", "-i", sourcePlan.output_path, "-c", "copy", output],
      output_path: output,
    };
    expect((await executePlan(copyPlan, profile, [sourcePlan.output_path])).ok).toBe(true);
    expect(existsSync(output)).toBe(true);
  });

  test("rejects a non-allowlisted binary", async () => {
    const plan = { ...generationPlan(), tool: "sh", command: ["sh", "-c", "true"] };
    await expect(executePlan(plan, profile, [])).rejects.toThrow("allowlisted");
  });

  test("rejects ungranted absolute paths", async () => {
    const plan = generationPlan();
    plan.command.splice(-1, 0, "/etc/passwd");
    await expect(executePlan(plan, profile, [])).rejects.toThrow("not explicitly granted");
  });

  test("rejects network input protocols", async () => {
    const plan = generationPlan();
    plan.command.splice(-1, 0, "https://example.com/input.mp4");
    await expect(executePlan(plan, profile, [])).rejects.toThrow("external protocol");
  });

  test("rejects heavy installs without explicit confirmation", async () => {
    await expect(
      executeInstall(
        "soffice",
        ["brew", "install", "--cask", "libreoffice"],
        profile,
        false,
      ),
    ).rejects.toThrow("explicit heavy-install confirmation");
  });

  test("requires literal boolean confirmation for heavy installs", async () => {
    await expect(
      executeInstall(
        "soffice",
        ["brew", "install", "--cask", "libreoffice"],
        profile,
        "yes",
      ),
    ).rejects.toThrow("explicit heavy-install confirmation");
  });

  test("rejects install commands that differ from policy", async () => {
    await expect(
      executeInstall("pandoc", ["brew", "install", "wget"], profile, true),
    ).rejects.toThrow("does not match policy");
  });

  test("caps caller-supplied timeouts at 30 minutes", async () => {
    await expect(
      executePlan(generationPlan(), profile, [], { timeoutMs: 30 * 60 * 1_000 + 1 }),
    ).rejects.toThrow(ExecutionError);
  });

  test("terminates work at a caller-supplied shorter timeout", async () => {
    const plan = generationPlan();
    plan.command[plan.command.indexOf("1", plan.command.indexOf("-t"))] = "10";
    const result = await executePlan(plan, profile, [], { timeoutMs: 1 });
    expect(result.ok).toBe(false);
    expect(result.timed_out).toBe(true);
  });

  test("returns nonzero exits with stderr evidence", async () => {
    const plan = generationPlan();
    plan.command[plan.command.indexOf("testsrc=size=64x64:rate=1")] = "not_a_filter";
    const result = await executePlan(plan, profile, []);
    expect(result.ok).toBe(false);
    expect(result.exit_code).not.toBe(0);
    expect(result.stderr_tail.length).toBeGreaterThan(0);
  });
});
