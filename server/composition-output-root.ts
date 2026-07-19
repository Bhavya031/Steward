import {
  chmodSync, constants, accessSync, mkdtempSync, realpathSync, rmSync, statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

type CleanupState = "active" | "cleaning" | "cleanup_failed" | "cleaned";
interface RootGrant {
  internal: string;
  final: string;
  state: CleanupState;
  remove: (path: string) => void;
}
const grants = new WeakMap<object, RootGrant>();

export interface CompositionOutputRootCapability {
  readonly __compositionOutputRoot: unique symbol;
}

export interface ManagedCompositionOutputRoot {
  capability: CompositionOutputRootCapability;
  cleanup: () => void;
}

function readableInput(path: unknown): string {
  if (typeof path !== "string" || path.includes("\0")) {
    throw new Error("composition input must be one staged path");
  }
  let real: string;
  try {
    real = realpathSync(path);
    if (!statSync(real).isFile()) throw new Error("not a file");
    accessSync(real, constants.R_OK);
  } catch {
    throw new Error("composition input must be a readable staged file");
  }
  return real;
}

export function createCompositionOutputRoot(
  inputPath: unknown,
): ManagedCompositionOutputRoot {
  return createCompositionOutputRootWithRemover(
    inputPath,
    (path) => rmSync(path, { recursive: true, force: true }),
  );
}

export function createCompositionOutputRootWithRemover(
  inputPath: unknown,
  remove: (path: string) => void,
): ManagedCompositionOutputRoot {
  const input = readableInput(inputPath);
  const created = mkdtempSync(join(tmpdir(), "steward-composition-"));
  let internal: string;
  try {
    internal = realpathSync(created);
    chmodSync(internal, 0o700);
  } catch (error) {
    rmSync(created, { recursive: true, force: true });
    throw error;
  }
  const capability = Object.freeze({}) as CompositionOutputRootCapability;
  const root: RootGrant = {
    internal, final: dirname(input), state: "active", remove,
  };
  grants.set(capability, root);
  return {
    capability,
    cleanup: () => {
      if (root.state === "cleaned") return;
      if (root.state === "cleaning") throw new Error("composition root cleanup is already running");
      root.state = "cleaning";
      try {
        root.remove(root.internal);
        root.state = "cleaned";
      } catch (error) {
        root.state = "cleanup_failed";
        throw error;
      }
    },
  };
}

function grant(value: unknown): RootGrant {
  if (typeof value !== "object" || value === null) {
    throw new Error("composition output-root capability is required");
  }
  const found = grants.get(value);
  if (!found) throw new Error("composition output-root capability is invalid or expired");
  if (found.state !== "active") {
    throw new Error(`composition output-root capability is unavailable during ${found.state}`);
  }
  return found;
}

export function compositionOutputRoots(capability: unknown): string[] {
  const found = grant(capability);
  return [found.internal, found.final];
}

export function compositionInternalRoot(capability: unknown): string {
  return grant(capability).internal;
}

export function compositionFinalRoot(capability: unknown): string {
  return grant(capability).final;
}
