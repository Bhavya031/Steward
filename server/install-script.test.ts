import {
  chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";

const projectRoot = resolve(import.meta.dir, "..");
const installer = join(projectRoot, "install.sh");
const root = mkdtempSync(join(tmpdir(), "steward-installer-"));

interface ShellResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function shell(
  functionName: string,
  args: string[] = [],
  environment: Record<string, string> = {},
  input?: string,
): ShellResult {
  const result = Bun.spawnSync([
    "/bin/bash", "-c", 'source "$1"; shift; "$@"',
    "installer-test", installer, functionName, ...args,
  ], {
    cwd: projectRoot,
    env: { ...process.env, ...environment },
    stdin: input === undefined ? undefined : Buffer.from(input),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function fixture(name: string): {
  repository: string;
  home: string;
  bun: string;
  log: string;
} {
  const directory = join(root, name);
  const repository = join(directory, "repo");
  const home = join(directory, "home");
  const bin = join(directory, "bin");
  const log = join(directory, "bun.log");
  mkdirSync(join(repository, "ui"), { recursive: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(repository, "package.json"), '{"private":true}\n');
  writeFileSync(join(repository, "bun.lockb"), "locked");
  const bun = join(bin, "bun");
  writeFileSync(bun, `#!/bin/bash
set -eu
printf '%s\\n' "$*" >> "$TEST_LOG"
if [ "\${FAIL_INSTALL:-0}" = "1" ] && [ "\${1:-}" = "install" ]; then
  exit 23
fi
if [ "\${1:-}" = "run" ] && [ "\${2:-}" = "ui:build" ]; then
  mkdir -p "$TEST_REPOSITORY/ui/dist"
  printf '<!doctype html>\\n' > "$TEST_REPOSITORY/ui/dist/index.html"
fi
`);
  chmodSync(bun, 0o755);
  return { repository, home, bun, log };
}

beforeEach(() => {
  for (const entry of Array.from(new Bun.Glob("*").scanSync(root))) {
    rmSync(join(root, entry), { recursive: true, force: true });
  }
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("root installer", () => {
  test("rejects non-macOS platforms with an actionable error", () => {
    const result = shell("require_macos", ["Linux"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("unsupported platform 'Linux'; Steward requires macOS");
  });

  test("resolves the approved Homebrew prefix for ARM and Intel", () => {
    const arm = shell("brew_prefix_for_arch", ["arm64"]);
    const intel = shell("brew_prefix_for_arch", ["x86_64"]);
    const unknown = shell("brew_prefix_for_arch", ["powerpc"]);
    expect(arm).toMatchObject({ exitCode: 0, stdout: "/opt/homebrew\n" });
    expect(intel).toMatchObject({ exitCode: 0, stdout: "/usr/local\n" });
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr).toContain("unsupported Mac architecture");
  });

  test("fails clearly when a required prerequisite is missing", () => {
    const result = shell(
      "require_executable",
      ["Homebrew", join(root, "missing", "brew"), "Install Homebrew and retry."],
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Homebrew is required");
    expect(result.stderr).toContain("Install Homebrew and retry");
  });

  test("installs missing Bun only through the approved Homebrew command after consent", () => {
    const prefix = join(root, "prefix");
    const bin = join(prefix, "bin");
    const log = join(root, "brew.log");
    mkdirSync(bin, { recursive: true });
    const brew = join(bin, "brew");
    writeFileSync(brew, `#!/bin/bash
set -eu
printf '%s\\n' "$*" >> "$TEST_BREW_LOG"
[ "$*" = "install bun" ]
printf '#!/bin/bash\\nexit 0\\n' > "$TEST_PREFIX/bin/bun"
chmod 755 "$TEST_PREFIX/bin/bun"
`);
    chmodSync(brew, 0o755);
    const result = shell(
      "ensure_bun",
      [prefix],
      { PATH: "/usr/bin:/bin", TEST_PREFIX: prefix, TEST_BREW_LOG: log },
      "y\n",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`${brew} install bun`);
    expect(result.stdout).toContain(`Bun installed: ${join(bin, "bun")}`);
    expect(readFileSync(log, "utf8")).toBe("install bun\n");
  });

  test("propagates locked dependency installation failures without building", () => {
    const item = fixture("failure");
    const result = shell(
      "install_project",
      [item.bun, item.repository, item.home],
      {
        TEST_REPOSITORY: item.repository,
        TEST_LOG: item.log,
        FAIL_INSTALL: "1",
      },
    );
    expect(result.exitCode).toBe(23);
    expect(readFileSync(item.log, "utf8")).toBe("install --frozen-lockfile\n");
  });

  test("is idempotent and creates only the restrictive model-cache state", () => {
    const item = fixture("idempotent");
    const environment = {
      TEST_REPOSITORY: item.repository,
      TEST_LOG: item.log,
    };
    const args = [item.bun, item.repository, item.home];
    expect(shell("install_project", args, environment).exitCode).toBe(0);
    expect(shell("install_project", args, environment).exitCode).toBe(0);
    expect(readFileSync(item.log, "utf8")).toBe(
      "install --frozen-lockfile\nrun ui:build\n".repeat(2),
    );
    const steward = join(item.home, "Library", "Caches", "Steward");
    expect(statSync(steward).mode & 0o777).toBe(0o700);
    expect(statSync(join(steward, "models")).mode & 0o777).toBe(0o700);
    expect(readdirSync(steward).sort()).toEqual(["models"]);
  });

  test("contains no alternate shell or silent download path", () => {
    const source = readFileSync(installer, "utf8");
    expect(source).not.toMatch(/\beval\b/);
    expect(source).not.toMatch(/\bsh\s+-c\b/);
    expect(source).not.toMatch(/\b(?:curl|wget)\b/);
    expect(source).toContain('"$bun_bin" install --frozen-lockfile');
    expect(source).toContain("bun run server/index.ts --serve");
  });
});
