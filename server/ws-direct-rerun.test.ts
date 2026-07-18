import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeSystem } from "./probe.ts";
import { save } from "./recipes.ts";
import { writeY4m } from "./test-fixtures.ts";
import { runEngineEvent } from "./ws-engine.ts";
import type { Plan } from "./plan.ts";
import type { ServerEvent } from "./ws-events.ts";

const root = mkdtempSync(join(tmpdir(), "steward-direct-workflow-"));
const catalog = join(root, "catalog");
const authoredInput = join(root, "authored.y4m");
const freshInput = join(root, "fresh.y4m");
const authoredOutput = join(root, "authored-copy.mp4");
const realRoot = realpathSync(root);
writeY4m(authoredInput, 0.2);
writeY4m(freshInput, 0.2);

const plan: Plan = {
  name: "copy-video-directly",
  tool: "ffmpeg",
  install_cmd: null,
  commands: [[
    "ffmpeg", "-loglevel", "error", "-i", authoredInput,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", authoredOutput,
  ]],
  output_path: authoredOutput,
  checks: [{ type: "plays", target: true }],
};
const profile = probeSystem();
const workflow = save({
  plan,
  inputPaths: [authoredInput],
  verification: [{
    name: "plays", pass: true, expected: "full decode", actual: "full decode",
  }],
  arch: profile.architecture,
}, catalog);
if (!workflow) throw new Error("test workflow was not saved");

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("stable-ID direct saved-workflow rerun", () => {
  test("bypasses matching and planning while retaining allocation, checks, and zero calls", async () => {
    const occupied = join(root, "fresh-copy.mp4");
    writeFileSync(occupied, "occupied");
    const events: ServerEvent[] = [];
    await runEngineEvent({
      type: "run_saved_workflow",
      workflow_id: workflow.name,
      files: [freshInput],
    }, (event) => events.push(event), { recipeDirectory: catalog, profile });

    expect(events.some((event) => event.type === "recipe_matched")).toBe(false);
    expect(events.some((event) => event.type === "model_call_count")).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({
      type: "workflow_selected",
      workflow_id: workflow.name,
      model_calls: 0,
    }));
    const started = events.find((event) => event.type === "command_started");
    if (started?.type !== "command_started") throw new Error("command was not started");
    expect(started.argv).toContain(freshInput);
    const completed = events.find((event) => event.type === "run_complete");
    expect(completed).toMatchObject({
      success: true,
      output_path: join(realRoot, "fresh-copy-2.mp4"),
      model_calls: 0,
    });
    expect(existsSync(join(realRoot, "fresh-copy-2.mp4"))).toBe(true);
    expect(events).toContainEqual(expect.objectContaining({
      type: "check_result", name: "plays", pass: true,
    }));
  });
});
