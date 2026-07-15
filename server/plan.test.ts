import { describe, expect, test } from "bun:test";
import { validatePlanForProfile } from "./agent.ts";
import { parsePlan, PlanValidationError, type Plan } from "./plan.ts";
import type { SystemProfile } from "./probe.ts";

const validPlan: Plan = {
  tool: "ffmpeg",
  install_cmd: null,
  command: ["ffmpeg", "-i", "/tmp/input.mp4", "/tmp/output.mp4"],
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

  test("rejects a command whose binary differs from tool", () => {
    const unsafe = { ...validPlan, command: ["sh", "-c", "ffmpeg ..."] };
    expect(() => parsePlan(JSON.stringify(unsafe))).toThrow("command[0]");
  });

  test("rejects non-brew install proposals", () => {
    const unsafe = { ...validPlan, install_cmd: ["curl", "-fsSL", "example.test"] };
    expect(() => parsePlan(JSON.stringify(unsafe))).toThrow("brew install");
  });

  test("rejects checks the verifier cannot dispatch", () => {
    const unknown = { ...validPlan, checks: [{ type: "looks_good", target: true }] };
    expect(() => parsePlan(JSON.stringify(unknown))).toThrow("not supported");
  });

  test("rejects install proposals for installed tools", () => {
    const plan = { ...validPlan, install_cmd: ["brew", "install", "ffmpeg"] };
    expect(() => validatePlanForProfile(plan, profile)).toThrow("must be null");
  });

  test("requires install proposals for missing tools", () => {
    const missing = { ...profile, tools: [{ ...profile.tools[0]!, installed: false }] };
    expect(() => validatePlanForProfile(validPlan, missing)).toThrow("is required");
  });
});
