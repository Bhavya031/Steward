import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync,
  statSync, unlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HOMEBREW_PROBE_TIMEOUT_MS, runHomebrewProbe,
} from "./probe.ts";

const root = mkdtempSync(join(tmpdir(), "steward-probe-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("system probe", () => {
  test("terminates a timed-out Homebrew probe without leaving it running", () => {
    const brew = join(root, "brew");
    const pidFile = `${brew}.pid`;
    writeFileSync(brew, `#!/bin/bash
set -eu
printf '%s\\n' "$$" > "\${0}.pid"
if [ "\${1:-}" = "--self-check" ]; then
  printf 'PATH=%s\\n' "$PATH"
  exit 0
fi
exec /bin/sleep 30
`);
    chmodSync(brew, 0o755);

    const resolvedCommand = Bun.which(brew);
    expect(resolvedCommand).not.toBeNull();
    const resolvedBrew = realpathSync(resolvedCommand!);
    expect(resolvedBrew).toBe(realpathSync(brew));
    expect(statSync(resolvedBrew).mode & 0o111).not.toBe(0);
    expect(readFileSync(resolvedBrew, "utf8").split("\n", 1)[0])
      .toBe("#!/bin/bash");
    expect(process.env.PATH).toBeTruthy();

    let spawnError: unknown;
    let selfCheck: Bun.SyncSubprocess<"pipe", "pipe"> | undefined;
    try {
      selfCheck = Bun.spawnSync([resolvedBrew, "--self-check"], {
        env: { ...process.env },
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch (error) {
      spawnError = error;
    }
    expect(spawnError).toBeUndefined();
    expect(selfCheck?.exitCode).toBe(0);
    expect(selfCheck?.stderr.toString()).toBe("");
    expect(selfCheck?.stdout.toString()).toBe(`PATH=${process.env.PATH}\n`);
    unlinkSync(pidFile);

    const started = performance.now();
    expect(runHomebrewProbe(resolvedBrew, ["--version"])).toBeNull();

    expect(performance.now() - started).toBeLessThan(
      HOMEBREW_PROBE_TIMEOUT_MS + 1_000,
    );
    const markerDeadline = performance.now() + 250;
    while (!existsSync(pidFile) && performance.now() < markerDeadline) {
      Bun.sleepSync(10);
    }
    expect(existsSync(pidFile)).toBeTrue();
    const pid = Number(readFileSync(pidFile, "utf8").trim());
    expect(() => process.kill(pid, 0)).toThrow();
  });
});
