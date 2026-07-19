import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CompositionCleanupError, CompositionRunFailureError, finalizeCompositionRun,
} from "./composition-cleanup.ts";
import { allocateInternalStageOutput } from "./composition-output-allocation.ts";
import {
  compositionInternalRoot, createCompositionOutputRootWithRemover,
} from "./composition-output-root.ts";
import type { CompositionRun } from "./composition-runtime.ts";

const root = mkdtempSync(join(tmpdir(), "steward-composition-cleanup-"));
const input = join(root, "input.mp4");
writeFileSync(input, "fixture");
afterAll(() => rmSync(root, { recursive: true, force: true }));

function run(success: boolean, executionOk: boolean): CompositionRun {
  return {
    composition_id: "cleanup-test",
    success,
    ...(success ? { output_path: join(root, "output.mp4") } : { failed_stage: 0 }),
    model_calls: 0,
    stages: [{
      stage_index: 0,
      source_id: "cleanup-stage",
      input_path: input,
      plan: {
        name: "cleanup-stage", tool: "ffmpeg", install_cmd: null,
        commands: [["ffmpeg", "-i", input, join(root, "output.mp4")]],
        output_path: join(root, "output.mp4"),
        checks: [{ type: "plays", target: true }],
      },
      execution: {
        ok: executionOk, exit_code: executionOk ? 0 : 1, timed_out: false,
        duration_ms: 1, stdout_tail: "", stderr_tail: "",
        command_results: [],
      },
      checks: executionOk ? [{
        name: "plays", pass: success, expected: "decodes", actual: success ? "decoded" : "failed",
        stage_index: 0, source_id: "cleanup-stage",
      }] : [],
      all_pass: success,
    }],
  };
}

function caught(callback: () => unknown): CompositionCleanupError {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(CompositionCleanupError);
    return error as CompositionCleanupError;
  }
  throw new Error("expected composition cleanup to fail");
}

describe("composition cleanup semantics", () => {
  test("preserves execution failure when failed-output deletion fails", () => {
    const deletion = new Error("delete failed");
    let rootAttempted = false;
    const error = caught(() => finalizeCompositionRun(run(false, false), null, [
      { action: "failed_output", run: () => { throw deletion; } },
      { action: "managed_root", run: () => { rootAttempted = true; } },
    ]));
    expect(rootAttempted).toBe(true);
    expect(error.cause).toBeInstanceOf(CompositionRunFailureError);
    expect(error.errors[0]).toBe(error.cause);
    expect(error.cleanupErrors).toEqual([{ action: "failed_output", error: deletion }]);
  });

  test("preserves verification failure when root cleanup fails", () => {
    const removal = new Error("root removal failed");
    const error = caught(() => finalizeCompositionRun(run(false, true), null, [
      { action: "failed_output", run: () => undefined },
      { action: "managed_root", run: () => { throw removal; } },
    ]));
    expect(error.cause).toBeInstanceOf(CompositionRunFailureError);
    expect((error.cause as CompositionRunFailureError).message).toContain("verification");
    expect(error.cleanupErrors[0]).toEqual({ action: "managed_root", error: removal });
  });

  test("records both cleanup failures without replacing the primary error", () => {
    const primary = new Error("execution threw");
    const stack = primary.stack!;
    const deletion = new Error("delete failed");
    const removal = new Error("remove failed");
    const attempted: string[] = [];
    const error = caught(() => finalizeCompositionRun(undefined, { error: primary }, [
      { action: "failed_output", run: () => { attempted.push("delete"); throw deletion; } },
      { action: "managed_root", run: () => { attempted.push("root"); throw removal; } },
    ]));
    expect(attempted).toEqual(["delete", "root"]);
    expect(error.cause).toBe(primary);
    expect(error.errors).toEqual([primary, deletion, removal]);
    expect(error.cleanupErrors).toEqual([
      { action: "failed_output", error: deletion },
      { action: "managed_root", error: removal },
    ]);
    expect(primary.stack).toBe(stack);
  });

  test("rethrows the exact primary error when cleanup succeeds", () => {
    const primary = new Error("derivation failed");
    expect(() => finalizeCompositionRun(undefined, { error: primary }, [
      { action: "failed_output", run: () => undefined },
      { action: "managed_root", run: () => undefined },
    ])).toThrow(primary);
  });

  test("turns successful execution into failure when cleanup fails", () => {
    const removal = new Error("cleanup after success failed");
    const error = caught(() => finalizeCompositionRun(run(true, true), null, [
      { action: "managed_root", run: () => { throw removal; } },
    ]));
    expect(error.hasPrimaryError).toBe(false);
    expect(error.errors).toEqual([removal]);
  });

  test("retries failed root cleanup, revokes reuse, then remains idempotent", () => {
    let attempts = 0;
    let managed!: ReturnType<typeof createCompositionOutputRootWithRemover>;
    const removal = new Error("first removal failed");
    managed = createCompositionOutputRootWithRemover(input, (path) => {
      attempts += 1;
      expect(() => compositionInternalRoot(managed.capability)).toThrow("cleaning");
      if (attempts === 1) throw removal;
      rmSync(path, { recursive: true, force: true });
    });
    const internal = compositionInternalRoot(managed.capability);
    expect(() => managed.cleanup()).toThrow(removal);
    expect(existsSync(internal)).toBe(true);
    expect(() => compositionInternalRoot(managed.capability)).toThrow("cleanup_failed");
    expect(() => allocateInternalStageOutput(
      run(true, true).stages[0]!.plan, input, managed.capability,
    )).toThrow("cleanup_failed");
    managed.cleanup();
    expect(existsSync(internal)).toBe(false);
    expect(() => compositionInternalRoot(managed.capability)).toThrow("cleaned");
    managed.cleanup();
    expect(attempts).toBe(2);
  });
});
