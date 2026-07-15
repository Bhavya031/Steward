import { describe, expect, test } from "bun:test";
import { buildPlannerPrompt, buildRepairPrompt } from "./agent-prompts.ts";
import { validatePlanForProfile } from "./agent.ts";
import { parsePlan, PlanValidationError, type Plan } from "./plan.ts";
import type { SystemProfile } from "./probe.ts";

const validPlan: Plan = {
  tool: "ffmpeg",
  install_cmd: null,
  commands: [["ffmpeg", "-i", "/tmp/input.mp4", "/tmp/output.mp4"]],
  output_path: "/tmp/output.mp4",
  checks: [{ type: "plays", target: true }],
};
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

describe("parsePlan", () => {
  test("accepts a strict plan", () => {
    expect(parsePlan(JSON.stringify(validPlan))).toEqual(validPlan);
  });

  test("strips a JSON markdown fence", () => {
    expect(parsePlan(`\`\`\`json\n${JSON.stringify(validPlan)}\n\`\`\``)).toEqual(
      validPlan,
    );
  });

  test("extracts a JSON object from surrounding text", () => {
    expect(parsePlan(`Plan follows:\n${JSON.stringify(validPlan)}\nDone.`)).toEqual(
      validPlan,
    );
  });

  test("rejects extra fields", () => {
    expect(() => parsePlan(JSON.stringify({ ...validPlan, note: "trust me" }))).toThrow(
      PlanValidationError,
    );
  });

  test("accepts ordered multi-command plans", () => {
    const twoPass = { ...validPlan, commands: [validPlan.commands[0], validPlan.commands[0]] };
    expect(parsePlan(JSON.stringify(twoPass)).commands).toHaveLength(2);
  });

  test("rejects a command whose binary differs from tool", () => {
    const unsafe = { ...validPlan, commands: [["sh", "-c", "ffmpeg ..."]] };
    expect(() => parsePlan(JSON.stringify(unsafe))).toThrow("commands[0][0]");
  });

  test("rejects non-brew install proposals", () => {
    const unsafe = { ...validPlan, install_cmd: ["curl", "-fsSL", "example.test"] };
    expect(() => parsePlan(JSON.stringify(unsafe))).toThrow("brew install");
  });

  test("rejects checks the verifier cannot dispatch", () => {
    const unknown = { ...validPlan, checks: [{ type: "looks_good", target: true }] };
    expect(() => parsePlan(JSON.stringify(unknown))).toThrow("not supported");
    const future = { ...validPlan, checks: [{ type: "format_matches", target: "mp4" }] };
    expect(() => parsePlan(JSON.stringify(future))).toThrow("not supported");
  });

  test("rejects install proposals for installed tools", () => {
    const plan = { ...validPlan, install_cmd: ["brew", "install", "ffmpeg"] };
    expect(() => validatePlanForProfile(plan, profile)).toThrow("must be null");
  });

  test("requires install proposals for missing tools", () => {
    const missing = { ...profile, tools: [{ ...profile.tools[0]!, installed: false }] };
    expect(() => validatePlanForProfile(validPlan, missing)).toThrow("is required");
  });

  test("planner and repair instructions contain no preselected two-pass strategy", () => {
    const failed = [{
      name: "duration_matches", pass: false,
      expected: "10.000 s ±0.500 s", actual: "4.000 s (Δ 6.000 s)",
    }];
    const prompts = [
      buildPlannerPrompt(profile, "compress this video under a size limit"),
      buildRepairPrompt(profile, {
        original_plan: validPlan,
        failed_checks: failed,
        stderr_tail: "measured stderr",
      }),
    ];
    for (const prompt of prompts) {
      expect(prompt.toLowerCase()).not.toContain("two-pass");
      expect(prompt.toLowerCase()).not.toContain("2-pass");
    }
    expect(prompts[1]).toContain("10.000 s ±0.500 s");
    expect(prompts[1]).toContain("measured stderr");
  });
});
