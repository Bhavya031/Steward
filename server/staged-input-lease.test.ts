import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompositionCleanupError } from "./composition-cleanup.ts";
import { CompositionSession } from "./composition-session.ts";
import {
  claimedStagedInputPath, cleanupClaimedStagedInput, StagedInputRegistry,
} from "./staged-input-registry.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(remove?: (path: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "steward-staged-lease-"));
  roots.push(root);
  const registry = new StagedInputRegistry(root, remove);
  const path = join(registry.root, "input.mov");
  writeFileSync(path, "private input");
  const id = registry.register(path);
  return { registry, path, id };
}

describe("claimed staged-input leases", () => {
  test("revokes the ID immediately and deletes exactly once", () => {
    let removals = 0;
    const item = fixture((path) => {
      removals += 1;
      rmSync(path);
    });
    const lease = item.registry.claim(item.id);
    expect(claimedStagedInputPath(lease)).toBe(item.path);
    expect(item.registry.has(item.id)).toBe(false);
    expect(() => item.registry.claim(item.id)).toThrow("already used");
    cleanupClaimedStagedInput(lease);
    cleanupClaimedStagedInput(lease);
    expect(removals).toBe(1);
    expect(existsSync(item.path)).toBe(false);
    expect(() => claimedStagedInputPath(lease)).toThrow("cleaned");
  });

  test("keeps deletion retryable after a filesystem failure", () => {
    let attempts = 0;
    const item = fixture((path) => {
      attempts += 1;
      if (attempts === 1) throw new Error("unlink refused");
      rmSync(path);
    });
    const lease = item.registry.claim(item.id);
    expect(() => cleanupClaimedStagedInput(lease)).toThrow("unlink refused");
    expect(existsSync(item.path)).toBe(true);
    expect(() => claimedStagedInputPath(lease)).toThrow("cleanup_failed");
    cleanupClaimedStagedInput(lease);
    cleanupClaimedStagedInput(lease);
    expect(attempts).toBe(2);
    expect(existsSync(item.path)).toBe(false);
  });

  test("preserves a primary failure and records staged cleanup separately", () => {
    const item = fixture(() => {
      throw new Error("staged deletion failed");
    });
    const session = new CompositionSession("run-primary");
    session.attachInput(item.registry.claim(item.id));
    const primary = new Error("execution failed");
    let caught: unknown;
    try {
      session.finalizeInput(primary);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CompositionCleanupError);
    const aggregate = caught as CompositionCleanupError;
    expect(aggregate.cause).toBe(primary);
    expect(aggregate.primaryError).toBe(primary);
    expect(aggregate.errors[0]).toBe(primary);
    expect(aggregate.cleanupErrors).toEqual([
      { action: "staged_input", error: expect.objectContaining({ message: "staged deletion failed" }) },
    ]);
  });
});
