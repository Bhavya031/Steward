import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentError, PLANNER_MODEL, planTask, resolveCodexBinary,
} from "./agent.ts";
import type { Plan } from "./plan.ts";
import type { SystemProfile } from "./probe.ts";
import { runEngineEvent } from "./ws-engine.ts";
import type { ServerEvent } from "./ws-events.ts";

const root = mkdtempSync(join(tmpdir(), "steward-codex-invocation-"));
const binary = join(root, "fake codex; shell syntax is data");
const failingBinary = join(root, "fake codex failure");
const invocationLog = join(root, "invocations.jsonl");
const injectedMarker = join(root, "prompt-was-executed");
const originalOverride = process.env.STEWARD_CODEX_BIN;

const profile: SystemProfile = {
  platform: "darwin",
  macosVersion: "test",
  architecture: "arm64",
  ram: { bytes: 1, gib: 1 },
  brew: {
    name: "brew",
    installed: true,
    install_weight: "light",
    binary: "/opt/homebrew/bin/brew",
    version: "test",
    expectedPrefix: "/opt/homebrew",
    actualPrefix: "/opt/homebrew",
  },
  tools: [{
    name: "ffmpeg",
    installed: true,
    install_weight: "light",
    binary: "/opt/homebrew/bin/ffmpeg",
    version: "test",
  }],
};

const validPlan: Plan = {
  name: "copy-media-locally",
  tool: "ffmpeg",
  install_cmd: null,
  commands: [["ffmpeg", "-i", "/tmp/input.mp4", "/tmp/output.mp4"]],
  output_path: "/tmp/output.mp4",
  checks: [{ type: "plays", target: true }],
};

function invocationRecorder(): string {
  return `import { appendFileSync } from "node:fs";
appendFileSync(
  ${JSON.stringify(invocationLog)},
  JSON.stringify(Bun.argv.slice(2)) + "\\n",
);`;
}

writeFileSync(binary, `#!/usr/bin/env bun
import { appendFileSync } from "node:fs";
${invocationRecorder().replace('import { appendFileSync } from "node:fs";\n', "")}
console.log(${JSON.stringify(JSON.stringify(validPlan))});
`);
chmodSync(binary, 0o700);
writeFileSync(failingBinary, `#!/usr/bin/env bun
${invocationRecorder()}
console.error("configured fake Codex failed");
process.exit(23);
`);
chmodSync(failingBinary, 0o700);

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  rmSync(invocationLog, { force: true });
  rmSync(injectedMarker, { force: true });
  process.env.STEWARD_CODEX_BIN = binary;
});

afterEach(() => {
  restore("STEWARD_CODEX_BIN", originalOverride);
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

function invocations(): string[][] {
  if (!existsSync(invocationLog)) return [];
  return readFileSync(invocationLog, "utf8").trim().split("\n").map((line) => {
    const value: unknown = JSON.parse(line);
    if (!Array.isArray(value) || !value.every((part) => typeof part === "string")) {
      throw new Error("fake Codex recorded malformed argv");
    }
    return value;
  });
}

describe("Codex CLI invocation boundary", () => {
  test("uses the configured executable once and passes an untrusted prompt as one argv value", async () => {
    const task = `make a copy; touch ${injectedMarker}; $(touch ${injectedMarker})`;
    let calls = 0;
    expect(resolveCodexBinary()).toBe(binary);
    const plan = await planTask(profile, task, "make a safe copy", () => {
      calls += 1;
    });

    expect(plan).toEqual(validPlan);
    expect(calls).toBe(1);
    expect(invocations()).toHaveLength(1);
    const [argv] = invocations();
    expect(argv?.slice(0, 8)).toEqual([
      "exec", "--ephemeral", "--sandbox", "read-only",
      "--model", PLANNER_MODEL, "--color", "never",
    ]);
    expect(argv?.[8]).toBe("--output-schema");
    expect(argv?.[9]).toEndWith("/server/plan.schema.json");
    expect(argv?.[10]).toContain(JSON.stringify(task));
    expect(existsSync(injectedMarker)).toBe(false);
  });

  test("reports a nonzero planning exit cleanly and saves nothing", async () => {
    process.env.STEWARD_CODEX_BIN = failingBinary;
    expect(resolveCodexBinary()).toBe(failingBinary);
    const catalog = join(root, "failed-catalog");
    const input = join(root, "fresh-input.txt");
    writeFileSync(input, "fresh input");
    const events: ServerEvent[] = [];

    await runEngineEvent({
      type: "run_task",
      task: "a never-before-saved transformation",
      files: [input],
    }, (event) => events.push(event), { recipeDirectory: catalog });

    expect(invocations()).toHaveLength(1);
    expect(events).toContainEqual(expect.objectContaining({
      type: "model_call_count", model_calls: 1,
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: "error",
      message: expect.stringContaining("Codex planning failed (23)"),
    }));
    expect(events.at(-1)).toMatchObject({ type: "run_complete", success: false });
    expect(existsSync(catalog) ? readdirSync(catalog) : []).toEqual([]);
  });

  test("fails before spawning when the configured path is missing", async () => {
    const missing = join(root, "missing codex");
    process.env.STEWARD_CODEX_BIN = missing;
    let calls = 0;

    expect(resolveCodexBinary).toThrow(
      `Codex CLI setup error: STEWARD_CODEX_BIN is not an executable file: ${missing}`,
    );
    await expect(planTask(profile, "fresh task", "fresh task", () => {
      calls += 1;
    })).rejects.toBeInstanceOf(AgentError);
    expect(calls).toBe(0);
    expect(invocations()).toEqual([]);
  });
});
