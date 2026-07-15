import { afterAll, describe, expect, test } from "bun:test";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { validateCommandPaths } from "./path-policy.ts";

const root = mkdtempSync(join(tmpdir(), "steward-output-policy-"));
const input = join(root, "input.mp4");
writeFileSync(input, "fixture");
afterAll(() => rmSync(root, { recursive: true, force: true }));

function command(output: string): string[] {
  return ["ffmpeg", "-i", input, "-c", "copy", output];
}

describe("output path confinement", () => {
  test("allows a new output next to the granted input", () => {
    const output = join(root, "output.mp4");
    expect(validateCommandPaths("ffmpeg", command(output), [input], output).output).toBe(
      join(realpathSync(root), "output.mp4"),
    );
  });

  test.each([
    join(homedir(), ".ssh", "authorized_keys"),
    join(homedir(), "Library", "LaunchAgents", "x.plist"),
    `/tmp/steward-outside-${process.pid}.mp4`,
  ])("rejects output outside every granted root: %s", (output) => {
    expect(() => validateCommandPaths("ffmpeg", command(output), [input], output)).toThrow();
  });

  test("resolves an output parent symlink before applying confinement", () => {
    const link = join(root, "escape");
    symlinkSync("/tmp", link);
    const output = join(link, `steward-symlink-${process.pid}.mp4`);
    expect(() => validateCommandPaths("ffmpeg", command(output), [input], output)).toThrow(
      "outside the input directory",
    );
  });

  test("rejects a dangling output symlink instead of following it on write", () => {
    const output = join(root, "dangling.mp4");
    symlinkSync("/tmp/steward-dangling-target.mp4", output);
    expect(() => validateCommandPaths("ffmpeg", command(output), [input], output)).toThrow(
      "output symlink",
    );
  });
});
