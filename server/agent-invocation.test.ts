import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  realpathSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentError, confirmCodexAuth, PLANNER_MODEL, planTask, resolveCodexBinary,
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
const authInvocationLog = join(root, "auth-invocations.log");
const originalOverride = process.env.STEWARD_CODEX_BIN;
const originalHome = process.env.HOME;
const originalPath = process.env.PATH;
const fallbackHome = join(root, "fallback home");
const homeBinary = join(fallbackHome, ".local", "bin", "codex");
const pathDirectory = join(root, "path with spaces");
const pathBinary = join(pathDirectory, "codex");

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

function writeExecutable(path: string, source = "#!/bin/bash\nexit 0\n"): void {
  writeFileSync(path, source);
  chmodSync(path, 0o700);
}

function writeAuthExecutable(
  path: string,
  status: { exitCode: number; output: string } = {
    exitCode: 23,
    output: "status unavailable",
  },
): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeExecutable(path, `#!/bin/bash
set -eu
printf '%s\\n' "$*" >> ${JSON.stringify(authInvocationLog)}
if [ "\${1:-}" = "login" ] && [ "$#" = "2" ] && [ "\${2:-}" = "status" ]; then
  printf '%s\\n' ${JSON.stringify(status.output)} ${status.exitCode === 0 ? "" : ">&2"}
  exit ${status.exitCode}
fi
if [ "\${1:-}" = "--version" ] && [ "$#" = "1" ]; then
  printf 'codex-cli test\\n'
  exit 0
fi
if [ "\${1:-}" = "login" ] && [ "$#" = "1" ]; then
  exit 0
fi
printf 'unexpected fake Codex argv\\n' >&2
exit 97
`);
}

mkdirSync(join(fallbackHome, ".local", "bin"), { recursive: true });
mkdirSync(pathDirectory, { recursive: true });
writeExecutable(homeBinary);
writeExecutable(pathBinary);
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
  rmSync(authInvocationLog, { force: true });
  process.env.STEWARD_CODEX_BIN = binary;
});

afterEach(() => {
  restore("STEWARD_CODEX_BIN", originalOverride);
  restore("HOME", originalHome);
  restore("PATH", originalPath);
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
    mkdirSync(catalog);
    writeFileSync(input, "fresh input");
    let calls = 0;
    const events: ServerEvent[] = [];

    await runEngineEvent({
      type: "run_task",
      task: "a never-before-saved transformation",
      files: [input],
    }, (event) => {
      events.push(event);
      if (event.type === "model_call_count") calls = event.model_calls;
    }, { recipeDirectory: catalog, profile });

    expect(calls).toBe(1);
    expect(invocations()).toHaveLength(1);
    expect(events).toContainEqual(expect.objectContaining({
      type: "error",
      message: expect.stringContaining("Codex planning failed (23)"),
    }));
    expect(events.at(-1)).toMatchObject({ type: "run_complete", success: false });
    expect(readdirSync(catalog)).toEqual([]);
  });

  test("fails before spawning when the configured path is missing", async () => {
    const missing = join(root, "missing codex");
    process.env.STEWARD_CODEX_BIN = missing;
    process.env.HOME = fallbackHome;
    process.env.PATH = `${pathDirectory}:/usr/bin:/bin`;
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

  test("uses HOME local Codex before PATH when no override is set", () => {
    delete process.env.STEWARD_CODEX_BIN;
    process.env.HOME = fallbackHome;
    process.env.PATH = `${pathDirectory}:/usr/bin:/bin`;

    expect(resolveCodexBinary()).toBe(homeBinary);
  });

  test("uses an absolute PATH result when HOME has no local Codex", () => {
    delete process.env.STEWARD_CODEX_BIN;
    process.env.HOME = join(root, "empty home");
    process.env.PATH = `${pathDirectory}:/usr/bin:/bin`;

    expect(resolveCodexBinary()).toBe(pathBinary);
  });

  test("reports actionable setup steps when no Codex executable exists", () => {
    delete process.env.STEWARD_CODEX_BIN;
    process.env.HOME = join(root, "empty home");
    process.env.PATH = "/usr/bin:/bin";

    expect(resolveCodexBinary).toThrow(
      "Install Codex CLI with `npm install -g @openai/codex`, " +
      "or set STEWARD_CODEX_BIN to its executable path.",
    );
  });

  test("treats an explicitly empty override as invalid without fallback", () => {
    process.env.STEWARD_CODEX_BIN = " ";
    process.env.HOME = fallbackHome;
    process.env.PATH = `${pathDirectory}:/usr/bin:/bin`;

    expect(resolveCodexBinary).toThrow(
      "STEWARD_CODEX_BIN is not an executable file: (empty)",
    );
  });

  test("rejects an existing non-executable override without fallback", () => {
    const nonExecutable = join(root, "non executable Codex");
    writeFileSync(nonExecutable, "#!/bin/bash\nexit 0\n");
    chmodSync(nonExecutable, 0o600);
    process.env.STEWARD_CODEX_BIN = nonExecutable;
    process.env.HOME = fallbackHome;
    process.env.PATH = `${pathDirectory}:/usr/bin:/bin`;

    expect(resolveCodexBinary).toThrow(
      `STEWARD_CODEX_BIN is not an executable file: ${nonExecutable}`,
    );
  });

  test("treats an empty PATH as no fallback instead of searching the working directory", () => {
    const cwdCodex = join(root, "codex");
    writeExecutable(cwdCodex);
    delete process.env.STEWARD_CODEX_BIN;
    process.env.HOME = join(root, "empty home");
    process.env.PATH = "";
    const previous = process.cwd();
    process.chdir(root);
    try {
      expect(resolveCodexBinary).toThrow("no executable was found");
    } finally {
      process.chdir(previous);
    }
  });

  test("supports empty and relative entries inside a nonempty PATH", () => {
    const cwdCodex = join(root, "codex");
    const relativeDirectory = join(root, "relative tools");
    const relativeCodex = join(relativeDirectory, "codex");
    mkdirSync(relativeDirectory, { recursive: true });
    writeExecutable(cwdCodex);
    writeExecutable(relativeCodex);
    delete process.env.STEWARD_CODEX_BIN;
    process.env.HOME = join(root, "empty home");
    const previous = process.cwd();
    process.chdir(root);
    try {
      process.env.PATH = ":relative tools:/usr/bin:/bin";
      expect(resolveCodexBinary()).toBe(realpathSync(cwdCodex));
      rmSync(cwdCodex);
      expect(resolveCodexBinary()).toBe(realpathSync(relativeCodex));
    } finally {
      process.chdir(previous);
    }
  });

  test("handles missing HOME and PATH predictably", () => {
    delete process.env.STEWARD_CODEX_BIN;
    delete process.env.HOME;
    process.env.PATH = `${pathDirectory}:/usr/bin:/bin`;
    expect(resolveCodexBinary()).toBe(pathBinary);

    delete process.env.PATH;
    expect(resolveCodexBinary).toThrow("no executable was found");
  });

  test("accepts successful authentication from exit status without fragile English output", () => {
    const authBinary = join(root, "successful auth", "codex");
    writeAuthExecutable(authBinary, {
      exitCode: 0,
      output: "AUTHENTICATED_WITHOUT_ENGLISH_GOLDEN",
    });
    process.env.STEWARD_CODEX_BIN = authBinary;

    expect(confirmCodexAuth()).toEqual({
      authenticated: true,
      method: "authenticated",
      cliVersion: "codex-cli test",
    });
    expect(readFileSync(authInvocationLog, "utf8")).toBe(
      "login status\n--version\n",
    );
  });

  const quotedAuthPaths = [
    ["spaces", "codex with spaces"],
    ["single quotes", "codex's executable"],
    ["double quotes", 'codex"quoted"'],
    ["backslashes", "codex\\backslash"],
    ["dollar signs", "codex$dollar"],
    ["semicolons", "codex; touch auth-injection-marker #"],
    ["command substitutions", "codex$(touch auth-substitution-marker)"],
  ] as const;

  for (const [label, filename] of quotedAuthPaths) {
    test(`quotes the actionable login command for ${label}`, () => {
      const authBinary = join(root, `auth ${label}`, filename);
      writeAuthExecutable(authBinary);
      process.env.STEWARD_CODEX_BIN = authBinary;

      let message = "";
      try {
        confirmCodexAuth();
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }

      expect(message).toContain("authentication is unavailable (exit 23): status unavailable");
      expect(readFileSync(authInvocationLog, "utf8")).toBe("login status\n");
      const marker = "Run: ";
      const markerIndex = message.indexOf(marker);
      expect(markerIndex).toBeGreaterThan(-1);
      const instruction = message.slice(markerIndex + marker.length);
      const login = Bun.spawnSync(["/bin/bash", "-c", instruction], {
        cwd: root,
        env: process.env,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(login.exitCode).toBe(0);
      expect(readFileSync(authInvocationLog, "utf8")).toBe(
        "login status\nlogin\n",
      );
      expect(existsSync(join(root, "auth-injection-marker"))).toBe(false);
      expect(existsSync(join(root, "auth-substitution-marker"))).toBe(false);
    });
  }

  test("contains no developer-specific Codex fallback", () => {
    const source = readFileSync(join(import.meta.dir, "agent.ts"), "utf8");
    expect(source).not.toContain(`/Users/${"bhavya"}`);
  });
});
