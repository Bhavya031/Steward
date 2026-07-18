import { describe, expect, test } from "bun:test";
import { buildPlannerPrompt, buildRepairPrompt } from "./agent-prompts.ts";
import { validatePlanForProfile, validatePlanNameForTask } from "./agent.ts";
import { parsePlan, PlanValidationError, type Plan } from "./plan.ts";
import type { SystemProfile } from "./probe.ts";

const validPlan: Plan = {
  name: "compress-video",
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
    expect(parsePlan(JSON.stringify({
      ...validPlan, derivations: null, intermediates: null,
    }))).toEqual(validPlan);
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

  test("requires a canonical kebab-case recipe name", () => {
    expect(() => parsePlan(JSON.stringify({ ...validPlan, name: "Make this smaller" }))).toThrow(
      "canonical kebab-case",
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
  });

  test("accepts the registered audio checks", () => {
    const checks: Plan["checks"] = [
      { type: "audio_stream_present", target: true },
      { type: "loudness_matches", target: -14 },
      { type: "true_peak_under", target: -1 },
    ];
    const audio = {
      ...validPlan,
      checks,
    };
    expect(parsePlan(JSON.stringify(audio)).checks).toEqual(checks);
  });

  test("accepts the registered document checks", () => {
    const checks: Plan["checks"] = [
      { type: "file_valid", target: "pdf" },
      { type: "page_count_positive", target: 1 },
      { type: "text_extractable", target: 20 },
      { type: "format_matches", target: "pdf" },
    ];
    expect(parsePlan(JSON.stringify({ ...validPlan, checks })).checks).toEqual(checks);
  });

  test("accepts source-bound OCR proof checks without widening the check shape", () => {
    const checks: Plan["checks"] = [
      { type: "file_valid", target: "pdf" },
      { type: "text_extractable", target: "/tmp/scanned.pdf" },
      { type: "page_count_positive", target: "/tmp/scanned.pdf" },
    ];
    expect(parsePlan(JSON.stringify({ ...validPlan, checks })).checks).toEqual(checks);
    expect(Object.keys(checks[1]!).sort()).toEqual(["target", "type"]);
  });

  test("rejects invalid document targets before execution", () => {
    const checks: Plan["checks"] = [
      { type: "file_valid", target: true },
      { type: "format_matches", target: "docx" },
      { type: "text_extractable", target: 1 },
    ];
    expect(() => parsePlan(JSON.stringify({ ...validPlan, checks }))).toThrow(
      "file_valid target must be pdf/docx/epub/html/md/txt",
    );
    expect(() => parsePlan(JSON.stringify({ ...validPlan, checks }))).toThrow(
      "text_extractable is not supported for DOCX output",
    );
  });

  test("rejects malformed OCR proof targets before execution", () => {
    const checks: Plan["checks"] = [
      { type: "text_extractable", target: false },
      { type: "page_count_positive", target: false },
    ];
    expect(() => parsePlan(JSON.stringify({ ...validPlan, checks }))).toThrow(
      "text_extractable target must be a positive integer or source path",
    );
    expect(() => parsePlan(JSON.stringify({ ...validPlan, checks }))).toThrow(
      "page_count_positive target must be a positive integer or source path",
    );
  });

  test("rejects a recipe name copied from the task wording", () => {
    const echoed = { ...validPlan, name: "make-this-markdown-into-a-word-doc" };
    expect(() => validatePlanNameForTask(echoed, "make this markdown into a Word doc")).toThrow(
      "not repeat the task wording",
    );
    expect(validatePlanNameForTask(
      { ...validPlan, name: "convert-markdown-to-docx" },
      "make this markdown into a Word doc",
    ).name).toBe("convert-markdown-to-docx");
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
      expect(prompt.toLowerCase()).not.toContain("two pass");
      expect(prompt.toLowerCase()).not.toContain("pass 1");
      expect(prompt.toLowerCase()).not.toContain("pass 2");
    }
    expect(prompts[0]).toContain("size_target_video_bitrate");
    expect(prompts[0]).toContain("Code runs only the derivation name and exact args declared");
    expect(prompts[0]).toContain("earlier ordinary file outputs must be declared in intermediates");
    expect(prompts[0]).toContain("canonical transformation in concise kebab-case");
    expect(prompts[0]).toContain("never the user's wording merely slugified");
    expect(prompts[0]).toContain("with no optional flags");
    expect(prompts[0]).toContain("page_count_positive targeting the granted input path");
    expect(prompts[1]).toContain("10.000 s ±0.500 s");
    expect(prompts[1]).toContain("measured stderr");
  });
});
