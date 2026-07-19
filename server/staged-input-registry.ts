import { randomUUID } from "node:crypto";
import { mkdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

type LeaseState = "active" | "cleaning" | "cleanup_failed" | "cleaned";
interface LeaseGrant {
  path: string;
  root: string;
  state: LeaseState;
  remove: (path: string) => void;
}
const leases = new WeakMap<object, LeaseGrant>();

export interface ClaimedStagedInput {
  readonly __claimedStagedInput: unique symbol;
}

function inside(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child !== "" && !child.startsWith("..") && !child.startsWith("/");
}

function stagedId(value: unknown): string {
  if (typeof value !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    throw new Error("staged input ID is invalid");
  }
  return value;
}

export class StagedInputRegistry {
  readonly root: string;
  readonly #paths = new Map<string, string>();
  readonly #remove: (path: string) => void;

  constructor(
    root = mkdtempSync(join(tmpdir(), "steward-inputs-")),
    remove: (path: string) => void = (path) => rmSync(path),
  ) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    this.root = realpathSync(root);
    this.#remove = remove;
  }

  register(path: string): string {
    const real = realpathSync(path);
    if (!inside(this.root, real) || dirname(real) !== this.root || !statSync(real).isFile()) {
      throw new Error("staged input is outside the authoritative staging root");
    }
    const id = randomUUID();
    this.#paths.set(id, real);
    return id;
  }

  claim(value: unknown): ClaimedStagedInput {
    const id = stagedId(value);
    const registered = this.#paths.get(id);
    if (!registered) throw new Error("staged input is unknown, expired, or already used");
    this.#paths.delete(id);
    let real: string;
    try {
      real = realpathSync(registered);
    } catch {
      throw new Error("staged input is no longer available");
    }
    if (!inside(this.root, real) || dirname(real) !== this.root || !statSync(real).isFile()) {
      throw new Error("staged input no longer belongs to the staging root");
    }
    const lease = Object.freeze({}) as ClaimedStagedInput;
    leases.set(lease, {
      path: real, root: this.root, state: "active", remove: this.#remove,
    });
    return lease;
  }

  has(value: unknown): boolean {
    try {
      return this.#paths.has(stagedId(value));
    } catch {
      return false;
    }
  }
}

function leaseGrant(value: unknown): LeaseGrant {
  if (typeof value !== "object" || value === null) {
    throw new Error("claimed staged-input lease is required");
  }
  const found = leases.get(value);
  if (!found) throw new Error("claimed staged-input lease is invalid");
  return found;
}

export function claimedStagedInputPath(value: unknown): string {
  const found = leaseGrant(value);
  if (found.state !== "active") {
    throw new Error(`claimed staged input is unavailable during ${found.state}`);
  }
  return found.path;
}

export function cleanupClaimedStagedInput(value: unknown): void {
  const found = leaseGrant(value);
  if (found.state === "cleaned") return;
  if (found.state === "cleaning") {
    throw new Error("claimed staged-input cleanup is already running");
  }
  if (!inside(found.root, found.path) || dirname(found.path) !== found.root) {
    throw new Error("claimed staged-input cleanup target escaped the staging root");
  }
  found.state = "cleaning";
  try {
    found.remove(found.path);
    found.state = "cleaned";
  } catch (error) {
    found.state = "cleanup_failed";
    throw error;
  }
}
