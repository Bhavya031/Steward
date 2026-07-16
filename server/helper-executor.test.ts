import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeHelperStep, executeInstall, executePlan } from "./executor.ts";
import type { SystemProfile } from "./probe.ts";

const root = mkdtempSync(join(tmpdir(), "steward-helpers-"));
const unusedProfile = {} as SystemProfile;

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("helper executor tier", () => {
  test("runs mkdir and cp steps inside granted roots", async () => {
    const source = join(root, "source.txt");
    const outputDirectory = join(root, "nested");
    const output = join(outputDirectory, "copy.txt");
    writeFileSync(source, "local-only\n");
    const grants = { read: [root], write: [root] };

    const made = await executeHelperStep(
      { tool: "mkdir", command: ["mkdir", outputDirectory] },
      grants,
    );
    const copied = await executeHelperStep(
      { tool: "cp", command: ["cp", source, output] },
      grants,
    );

    expect(made.ok).toBe(true);
    expect(copied.ok).toBe(true);
    expect(readFileSync(output, "utf8")).toBe("local-only\n");
  });

  test("rejects helper paths outside granted roots", async () => {
    await expect(
      executeHelperStep(
        { tool: "mkdir", command: ["mkdir", join(tmpdir(), "steward-ungranted")] },
        { read: [root], write: [root] },
      ),
    ).rejects.toThrow("outside granted roots");
  });

  test("rejects helpers as recipe-forming primary tools", async () => {
    const invalidPrimary = {
      name: "create-directory",
      tool: "mkdir",
      install_cmd: null,
      commands: [["mkdir", join(root, "primary")]],
      output_path: join(root, "primary"),
      checks: [{ type: "file_valid", target: true }],
    };
    await expect(executePlan(invalidPrimary, unusedProfile, [])).rejects.toThrow(
      "allowlisted task binary",
    );
  });

  test("rejects helper install proposals and install fields", async () => {
    await expect(
      executeInstall("mkdir", ["brew", "install", "mkdir"], unusedProfile, true),
    ).rejects.toThrow("install tool is not allowlisted");
    mkdirSync(join(root, "existing"));
    await expect(
      executeHelperStep(
        {
          tool: "mkdir",
          command: ["mkdir", join(root, "never")],
          install_cmd: ["brew", "install", "mkdir"],
        },
        { read: [root], write: [root] },
      ),
    ).rejects.toThrow("invalid helper step");
  });
});
