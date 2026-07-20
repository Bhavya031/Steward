import {
  chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync,
  rmSync, statSync, writeFileSync,
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

function shellBody(
  body: string,
  args: string[] = [],
  environment: Record<string, string> = {},
): ShellResult {
  const result = Bun.spawnSync([
    "/bin/bash", "-c", `source "$1"; shift; ${body}`,
    "installer-test", installer, ...args,
  ], {
    cwd: projectRoot,
    env: { ...process.env, ...environment },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function bashScript(
  script: string,
  args: string[] = [],
  environment: Record<string, string> = {},
): ShellResult {
  const result = Bun.spawnSync([
    "/bin/bash", "-c", script, "installer-test", ...args,
  ], {
    cwd: projectRoot,
    env: { ...process.env, ...environment },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function shadowingFunctions(marker: string): string {
  const target = JSON.stringify(marker);
  return `cd() { builtin printf '%s\\n' "cd $*" >> ${target}; builtin cd "$@"; }
pwd() { builtin printf '%s\\n' "pwd $*" >> ${target}; builtin pwd "$@"; }
export -f cd pwd`;
}

function fakeCodex(path: string): string {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, `#!/bin/bash
set -eu
printf '%s\\n' "$*" >> "$CODEX_TEST_LOG"
case "\${1:-}" in
  --version)
    [ "$#" = "1" ]
    printf 'codex-cli test\\n'
    ;;
  login)
    if [ "$#" = "1" ]; then
      exit 0
    fi
    [ "$#" = "2" ] && [ "\${2:-}" = "status" ]
    if [ "\${CODEX_TEST_AUTHENTICATED:-1}" = "1" ]; then
      printf '%s\\n' "\${CODEX_TEST_STATUS_OUTPUT:-authenticated}"
    else
      printf '%s\\n' "\${CODEX_TEST_STATUS_OUTPUT:-Not logged in}" >&2
      exit "\${CODEX_TEST_STATUS_EXIT:-1}"
    fi
    ;;
  *)
    printf 'unexpected Codex invocation\\n' >&2
    exit 97
    ;;
esac
`);
  chmodSync(path, 0o755);
  return path;
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
printf '%s|%s\\n' "$0" "$*" >> "$TEST_LOG"
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

function bunInvocations(log: string): Array<{ executable: string; argv: string }> {
  return readFileSync(log, "utf8").trim().split("\n").map((line) => {
    const separator = line.indexOf("|");
    if (separator < 1) throw new Error("fake Bun recorded malformed invocation");
    return {
      executable: line.slice(0, separator),
      argv: line.slice(separator + 1),
    };
  });
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
    expect(result.stdout).toContain(`Bun installed: ${realpathSync(join(bin, "bun"))}`);
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
    expect(bunInvocations(item.log).map(({ argv }) => argv)).toEqual([
      "install --frozen-lockfile",
    ]);
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
    expect(bunInvocations(item.log).map(({ argv }) => argv)).toEqual([
      "install --frozen-lockfile", "run ui:build",
      "install --frozen-lockfile", "run ui:build",
    ]);
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
    expect(source).toContain("printf '  %q run server/index.ts --serve");
    expect(source).not.toContain(`/Users/${"bhavya"}`);
  });

  test("uses a valid explicit Codex override before HOME and PATH", () => {
    const explicit = fakeCodex(join(root, "explicit path", "codex"));
    const home = join(root, "home");
    fakeCodex(join(home, ".local", "bin", "codex"));
    const pathDirectory = join(root, "path bin");
    fakeCodex(join(pathDirectory, "codex"));

    const result = shellBody(
      'resolve_codex; printf "resolved=%s\\n" "$CODEX_BIN"',
      [],
      {
        STEWARD_CODEX_BIN: explicit,
        HOME: home,
        PATH: `${pathDirectory}:/usr/bin:/bin`,
      },
    );

    expect(result).toMatchObject({
      exitCode: 0,
      stdout: `resolved=${realpathSync(explicit)}\n`,
    });
  });

  test("fails an invalid explicit Codex override without falling back", () => {
    const home = join(root, "home");
    fakeCodex(join(home, ".local", "bin", "codex"));
    const pathDirectory = join(root, "path bin");
    fakeCodex(join(pathDirectory, "codex"));
    const missing = join(root, "missing explicit Codex");

    const result = shell("resolve_codex", [], {
      STEWARD_CODEX_BIN: missing,
      HOME: home,
      PATH: `${pathDirectory}:/usr/bin:/bin`,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Codex CLI from STEWARD_CODEX_BIN is required");
    expect(result.stderr).toContain("Fix STEWARD_CODEX_BIN or unset it");
  });

  test("rejects an existing non-executable explicit Codex override without fallback", () => {
    const home = join(root, "home");
    fakeCodex(join(home, ".local", "bin", "codex"));
    const pathDirectory = join(root, "path bin");
    fakeCodex(join(pathDirectory, "codex"));
    const nonExecutable = join(root, "non executable Codex");
    writeFileSync(nonExecutable, "#!/bin/bash\nexit 0\n");
    chmodSync(nonExecutable, 0o600);

    const result = shell("resolve_codex", [], {
      STEWARD_CODEX_BIN: nonExecutable,
      HOME: home,
      PATH: `${pathDirectory}:/usr/bin:/bin`,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Codex CLI from STEWARD_CODEX_BIN is required");
  });

  test("uses HOME local Codex before PATH when no override is set", () => {
    const home = join(root, "home with spaces");
    const local = fakeCodex(join(home, ".local", "bin", "codex"));
    const pathDirectory = join(root, "path bin");
    fakeCodex(join(pathDirectory, "codex"));

    const result = shellBody(
      'unset STEWARD_CODEX_BIN; resolve_codex; printf "resolved=%s\\n" "$CODEX_BIN"',
      [],
      { HOME: home, PATH: `${pathDirectory}:/usr/bin:/bin` },
    );

    expect(result).toMatchObject({
      exitCode: 0,
      stdout: `resolved=${realpathSync(local)}\n`,
    });
  });

  test("falls back to an absolute Codex executable resolved from PATH", () => {
    const home = join(root, "empty home");
    mkdirSync(home, { recursive: true });
    const pathDirectory = join(root, "path with spaces");
    const fromPath = fakeCodex(join(pathDirectory, "codex"));

    const result = shellBody(
      'unset STEWARD_CODEX_BIN; resolve_codex; printf "resolved=%s\\n" "$CODEX_BIN"',
      [],
      { HOME: home, PATH: `${pathDirectory}:/usr/bin:/bin` },
    );

    expect(result).toMatchObject({
      exitCode: 0,
      stdout: `resolved=${realpathSync(fromPath)}\n`,
    });
  });

  test("treats an empty PATH as no fallback and handles an unset PATH intentionally", () => {
    const home = join(root, "empty home");
    mkdirSync(home, { recursive: true });
    const empty = shellBody(
      'unset STEWARD_CODEX_BIN; PATH=""; resolve_codex',
      [],
      { HOME: home },
    );
    const missing = shellBody(
      "unset STEWARD_CODEX_BIN PATH; resolve_codex",
      [],
      { HOME: home },
    );

    expect(empty.exitCode).toBe(1);
    expect(missing.exitCode).toBe(1);
    expect(empty.stderr).toContain("Codex CLI was not found");
    expect(missing.stderr).toContain("Codex CLI was not found");
    expect(empty.stderr).not.toContain("unbound variable");
    expect(missing.stderr).not.toContain("unbound variable");
  });

  test("supports empty and relative entries inside a nonempty PATH", () => {
    const home = join(root, "empty home");
    const cwdDirectory = join(root, "current tools");
    const relativeDirectory = join(cwdDirectory, "relative tools");
    mkdirSync(home, { recursive: true });
    mkdirSync(relativeDirectory, { recursive: true });
    const cwdCodex = fakeCodex(join(cwdDirectory, "codex"));
    const relativeCodex = fakeCodex(join(relativeDirectory, "codex"));

    const emptyEntry = shellBody(
      'cd -- "$1"; unset STEWARD_CODEX_BIN; PATH=":/usr/bin:/bin"; resolve_codex; printf "resolved=%s\\n" "$CODEX_BIN"',
      [cwdDirectory],
      { HOME: home },
    );
    const resolvedCwdCodex = realpathSync(cwdCodex);
    rmSync(cwdCodex);
    const relativeEntry = shellBody(
      'cd -- "$1"; unset STEWARD_CODEX_BIN; PATH="relative tools:/usr/bin:/bin"; resolve_codex; printf "resolved=%s\\n" "$CODEX_BIN"',
      [cwdDirectory],
      { HOME: home },
    );

    expect(emptyEntry).toMatchObject({
      exitCode: 0,
      stdout: `resolved=${resolvedCwdCodex}\n`,
    });
    expect(relativeEntry).toMatchObject({
      exitCode: 0,
      stdout: `resolved=${realpathSync(relativeCodex)}\n`,
    });
  });

  test("rejects unset and empty HOME with intentional errors", () => {
    const unset = shellBody('unset HOME; require_absolute_home "${HOME:-}"');
    const empty = shellBody('HOME=""; require_absolute_home "${HOME:-}"');

    expect(unset.exitCode).toBe(1);
    expect(empty.exitCode).toBe(1);
    expect(unset.stderr).toContain("HOME must be set to an absolute user directory");
    expect(empty.stderr).toContain("HOME must be set to an absolute user directory");
    expect(unset.stderr).not.toContain("unbound variable");
    expect(empty.stderr).not.toContain("unbound variable");
  });

  test("does not execute PATH-controlled dirname or basename replacements", () => {
    const malicious = join(root, "malicious helpers");
    const marker = join(root, "malicious-helper-ran");
    mkdirSync(malicious, { recursive: true });
    for (const name of ["dirname", "basename"]) {
      const helper = join(malicious, name);
      writeFileSync(helper, `#!/bin/bash
printf '%s\\n' ${JSON.stringify(name)} >> "$MALICIOUS_HELPER_MARKER"
exit 91
`);
      chmodSync(helper, 0o755);
    }
    const codex = fakeCodex(join(root, "portable Codex", "codex"));
    const result = shellBody(
      'resolve_codex; printf "resolved=%s\\n" "$CODEX_BIN"',
      [],
      {
        STEWARD_CODEX_BIN: codex,
        PATH: `${malicious}:/usr/bin:/bin`,
        MALICIOUS_HELPER_MARKER: marker,
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`resolved=${realpathSync(codex)}\n`);
    expect(readFileSync(installer, "utf8")).not.toMatch(/\b(?:dirname|basename|readlink|realpath)\b/);
    expect(() => readFileSync(marker, "utf8")).toThrow();
  });

  test("reports actionable installation steps when Codex is missing", () => {
    const home = join(root, "empty home");
    mkdirSync(home, { recursive: true });

    const result = shellBody(
      "unset STEWARD_CODEX_BIN; resolve_codex",
      [],
      { HOME: home, PATH: "/usr/bin:/bin" },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("npm install -g @openai/codex");
    expect(result.stderr).toContain("set STEWARD_CODEX_BIN");
  });

  test("reports an actionable login command when Codex is unauthenticated", () => {
    const codex = fakeCodex(join(
      root,
      "Codex path with spaces",
      `codex 'single' "double" \\ $dollar; touch installer-auth-marker; $(touch installer-substitution-marker)`,
    ));
    const log = join(root, "codex-auth.log");

    const result = shellBody(
      'resolve_codex; validate_codex_readiness "$CODEX_BIN"',
      [],
      {
        STEWARD_CODEX_BIN: codex,
        CODEX_TEST_LOG: log,
        CODEX_TEST_AUTHENTICATED: "0",
        CODEX_TEST_STATUS_OUTPUT: "DISTINCTIVE_STATUS_DIAGNOSTIC token expired",
        CODEX_TEST_STATUS_EXIT: "23",
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Codex CLI authentication is unavailable (exit 23): " +
      "DISTINCTIVE_STATUS_DIAGNOSTIC token expired",
    );
    expect(readFileSync(log, "utf8")).toBe("--version\nlogin status\n");
    const marker = "Run: ";
    const markerIndex = result.stderr.indexOf(marker);
    expect(markerIndex).toBeGreaterThan(-1);
    const instruction = result.stderr.slice(markerIndex + marker.length).trim();
    const login = Bun.spawnSync(["/bin/bash", "-c", instruction], {
      cwd: root,
      env: { ...process.env, CODEX_TEST_LOG: log },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(login.exitCode).toBe(0);
    expect(readFileSync(log, "utf8")).toBe("--version\nlogin status\nlogin\n");
    expect(() => readFileSync(join(root, "installer-auth-marker"))).toThrow();
    expect(() => readFileSync(join(root, "installer-substitution-marker"))).toThrow();
  });

  test("readiness trusts a successful status exit without fragile English output", () => {
    const codex = fakeCodex(join(root, "ready Codex", "codex"));
    const log = join(root, "codex-ready.log");

    const result = shellBody(
      'resolve_codex; validate_codex_readiness "$CODEX_BIN"',
      [],
      {
        STEWARD_CODEX_BIN: codex,
        CODEX_TEST_LOG: log,
        CODEX_TEST_STATUS_OUTPUT: "AUTHENTICATED_WITHOUT_ENGLISH_GOLDEN",
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Codex ready: codex-cli test\n");
    expect(readFileSync(log, "utf8")).toBe("--version\nlogin status\n");
    expect(readFileSync(log, "utf8")).not.toContain("exec");
  });

  test("executes and prints only the supplied absolute Bun path with safe quoting", () => {
    const item = fixture("Bun path with spaces");
    const resolvedBun = realpathSync(item.bun);
    const decoyDirectory = join(root, "decoy");
    const decoyMarker = join(root, "decoy-bun-ran");
    mkdirSync(decoyDirectory, { recursive: true });
    const decoy = join(decoyDirectory, "bun");
    writeFileSync(decoy, `#!/bin/bash
printf 'decoy\\n' >> "$DECOY_BUN_MARKER"
exit 91
`);
    chmodSync(decoy, 0o755);
    const result = shellBody(
      'BUN_BIN="$(absolute_executable_path "$1")"; install_project "$BUN_BIN" "$2" "$3"; print_launch_instructions "$BUN_BIN"',
      [item.bun, item.repository, item.home],
      {
        PATH: `${decoyDirectory}:/usr/bin:/bin`,
        TEST_REPOSITORY: item.repository,
        TEST_LOG: item.log,
        DECOY_BUN_MARKER: decoyMarker,
      },
    );

    expect(result.exitCode).toBe(0);
    expect(bunInvocations(item.log)).toEqual([
      { executable: resolvedBun, argv: "install --frozen-lockfile" },
      { executable: resolvedBun, argv: "run ui:build" },
    ]);
    expect(() => readFileSync(decoyMarker, "utf8")).toThrow();
    const launchLine = result.stdout.trim().split("\n").at(-1)?.trim();
    expect(launchLine).toBeDefined();
    if (launchLine === undefined) throw new Error("launch command was not printed");
    const launch = Bun.spawnSync(["/bin/bash", "-c", launchLine], {
      cwd: item.repository,
      env: {
        ...process.env,
        PATH: `${decoyDirectory}:/usr/bin:/bin`,
        TEST_REPOSITORY: item.repository,
        TEST_LOG: item.log,
        DECOY_BUN_MARKER: decoyMarker,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(launch.exitCode).toBe(0);
    expect(bunInvocations(item.log)).toEqual([
      { executable: resolvedBun, argv: "install --frozen-lockfile" },
      { executable: resolvedBun, argv: "run ui:build" },
      { executable: resolvedBun, argv: "run server/index.ts --serve" },
    ]);
    expect(() => readFileSync(decoyMarker, "utf8")).toThrow();
  });

  test("ignores caller-exported cd and pwd functions when the installer is executed", () => {
    const control = join(root, "shadow-control-marker");
    const marker = join(root, "shadow-executed-marker");
    const shadowed = bashScript(
      `${shadowingFunctions(control)}\ncd -- / >/dev/null; pwd -P >/dev/null`,
    );
    expect(shadowed.exitCode).toBe(0);
    expect(readFileSync(control, "utf8")).toBe("cd -- /\npwd -P\n");

    for (const invocation of ['"$1"', '/bin/bash "$1"']) {
      rmSync(marker, { force: true });
      const result = bashScript(
        `${shadowingFunctions(marker)}\nunset HOME\n${invocation}`,
        [installer],
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("HOME must be set to an absolute user directory");
      expect(existsSync(marker)).toBe(false);
    }
  });

  test("fails closed when a caller-exported exec swallows the privileged re-exec", () => {
    const resolutionMarker = join(root, "reexec-resolution-marker");
    const execMarker = join(root, "reexec-exec-marker");
    const bashEnvMarker = join(root, "reexec-bash-env-marker");
    const bashEnvFile = join(root, "hostile-bash-env.sh");
    const unreachable = join(root, "unreachable path");
    mkdirSync(unreachable, { recursive: true });
    writeFileSync(bashEnvFile, `printf 'sourced\\n' >> ${JSON.stringify(bashEnvMarker)}\n`);
    const shadows = `${shadowingFunctions(resolutionMarker)}
exec() { command printf 'exec %s\\n' "$*" >> ${JSON.stringify(execMarker)}; return 0; }
builtin() { command printf 'builtin %s\\n' "$1" >> ${JSON.stringify(resolutionMarker)}; command builtin "$@"; }
export -f exec builtin`;
    const environment = {
      PATH: `${unreachable}:/usr/bin:/bin`,
      HOME: unreachable,
      STEWARD_CODEX_BIN: fakeCodex(join(unreachable, "fake codex", "codex")),
      CODEX_TEST_LOG: join(root, "reexec-codex-must-not-run.log"),
    };

    for (const preset of ["", "export __STEWARD_PRIVILEGED_REEXEC_FAILED=anything\n"]) {
      rmSync(resolutionMarker, { force: true });
      rmSync(execMarker, { force: true });
      const result = bashScript(
        `${shadows}\n${preset}unset HOME\n/bin/bash "$1"`,
        [installer],
        environment,
      );

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("must run under bash -p");
      expect(readFileSync(execMarker, "utf8")).toContain("/bin/bash -p");
      expect(existsSync(resolutionMarker)).toBe(false);
    }

    const control = bashScript(
      `export BASH_ENV=${JSON.stringify(bashEnvFile)}\n/bin/bash -c 'exit 0'`,
    );
    expect(control.exitCode).toBe(0);
    expect(existsSync(bashEnvMarker)).toBe(true);

    rmSync(bashEnvMarker, { force: true });
    rmSync(resolutionMarker, { force: true });
    const privileged = bashScript(
      `${shadows}\nunset HOME\nexport BASH_ENV=${JSON.stringify(bashEnvFile)}\n"$1"`,
      [installer],
      environment,
    );

    expect(privileged.exitCode).toBe(1);
    expect(privileged.stderr).toContain("HOME must be set to an absolute user directory");
    expect(existsSync(bashEnvMarker)).toBe(false);
    expect(existsSync(resolutionMarker)).toBe(false);
    expect(existsSync(join(root, "reexec-codex-must-not-run.log"))).toBe(false);
  });

  test("resolves Codex and Bun through built-ins when sourced with exported cd and pwd", () => {
    const marker = join(root, "shadow-sourced-marker");
    const home = join(root, "empty home");
    mkdirSync(home, { recursive: true });
    const codex = fakeCodex(join(root, "shadowed codex", "codex"));
    const bunDirectory = join(root, "shadowed bun");
    mkdirSync(bunDirectory, { recursive: true });
    const fakeBun = join(bunDirectory, "bun");
    writeFileSync(fakeBun, "#!/bin/bash\nexit 0\n");
    chmodSync(fakeBun, 0o755);

    const result = bashScript(
      `${shadowingFunctions(marker)}
source "$1"
declare -F cd >/dev/null && declare -F pwd >/dev/null && printf 'shadows-still-defined\\n'
resolve_codex
printf 'codex=%s\\n' "$CODEX_BIN"
printf 'bun=%s\\n' "$(executable_from_path bun)"`,
      [installer],
      {
        HOME: home,
        STEWARD_CODEX_BIN: codex,
        PATH: `${bunDirectory}:/usr/bin:/bin`,
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "shadows-still-defined\n" +
      `codex=${realpathSync(codex)}\n` +
      `bun=${realpathSync(fakeBun)}\n`,
    );
    expect(existsSync(marker)).toBe(false);
  });
});
