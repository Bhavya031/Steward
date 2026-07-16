import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { TEMP_DIR_SLOT } from "./intermediate-policy.ts";
import { parsePlan, type Plan } from "./plan.ts";

const input = "/tmp/steward-input/source.mp4";
const output = "/tmp/steward-input/output.mp4";
const stage = `${TEMP_DIR_SLOT}/stage.mkv`;
const plan: Plan = {
  name: "convert-video",
  tool: "ffmpeg", install_cmd: null,
  commands: [
    ["ffmpeg", "-i", input, "-c", "copy", stage],
    ["ffmpeg", "-i", stage, "-c", "copy", output],
  ],
  output_path: output, checks: [{ type: "plays", target: true }],
  intermediates: [stage],
};

describe("intermediate declarations", () => {
  test("accepts a unique direct Steward temp child", () => {
    expect(parsePlan(JSON.stringify(plan))).toEqual(plan);
    const nullable = { ...plan, intermediates: null };
    expect(parsePlan(JSON.stringify(nullable)).intermediates).toBeUndefined();
  });

  test.each([
    join(homedir(), ".ssh", "authorized_keys"),
    "/tmp/steward-input/stage.mkv",
    `${TEMP_DIR_SLOT}/../escape.mkv`,
  ])("refuses an intermediate outside the Steward temp root: %s", (path) => {
    expect(() => parsePlan(JSON.stringify({ ...plan, intermediates: [path] }))).toThrow(
      `direct child of ${TEMP_DIR_SLOT}`,
    );
  });

  test("refuses duplicate declarations", () => {
    expect(() => parsePlan(JSON.stringify({ ...plan, intermediates: [stage, stage] }))).toThrow(
      "must be unique",
    );
  });
});
