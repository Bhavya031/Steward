import {
  CompositionCleanupError, type CleanupFailure, type PrimaryFailure,
} from "./composition-cleanup.ts";
import { ExecutionCancelledError } from "./execution-types.ts";
import {
  claimedStagedInputPath, cleanupClaimedStagedInput,
  type ClaimedStagedInput,
} from "./staged-input-registry.ts";
import type { EmitWsEvent, WsServerEvent } from "./ws-events.ts";

type SessionState = "active" | "cancelled" | "settled";

export class CompositionSession {
  readonly controller = new AbortController();
  readonly runId: string;
  #state: SessionState = "active";
  #input?: ClaimedStagedInput;
  #cleanupErrors: CleanupFailure[] = [];
  #inputCleaned = false;

  constructor(runId: string) {
    this.runId = runId;
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get cancelled(): boolean {
    return this.#state === "cancelled";
  }

  get inputCleanupComplete(): boolean {
    return !this.#input || this.#inputCleaned;
  }

  attachInput(input: ClaimedStagedInput): void {
    if (this.#input) throw new Error("composition session already owns a staged input");
    this.#input = input;
    if (this.cancelled) {
      this.#attemptInputCleanup();
      this.assertActive();
    }
  }

  inputPath(): string {
    this.assertActive();
    if (!this.#input) throw new Error("composition session has no claimed staged input");
    return claimedStagedInputPath(this.#input);
  }

  emit(emit: EmitWsEvent, event: WsServerEvent): void {
    if (!this.cancelled) emit(event);
  }

  assertActive(): void {
    if (!this.controller.signal.aborted) return;
    const primary = { error: this.controller.signal.reason } satisfies PrimaryFailure;
    if (this.#cleanupErrors.length) {
      throw new CompositionCleanupError(primary, [...this.#cleanupErrors]);
    }
    throw primary.error;
  }

  cancel(reason: unknown = new ExecutionCancelledError()): void {
    if (!this.controller.signal.aborted) {
      this.#state = "cancelled";
      this.controller.abort(reason);
    }
    this.#attemptInputCleanup();
  }

  finalizeInput(primaryError: unknown | null = null): void {
    this.#attemptInputCleanup();
    const primary = primaryError === null ? null : { error: primaryError };
    if (this.#cleanupErrors.length) {
      throw new CompositionCleanupError(primary, [...this.#cleanupErrors]);
    }
    if (primary) throw primary.error;
  }

  settle(): void {
    if (!this.cancelled) this.#state = "settled";
  }

  #attemptInputCleanup(): void {
    if (!this.#input || this.#inputCleaned) return;
    try {
      cleanupClaimedStagedInput(this.#input);
      this.#inputCleaned = true;
    } catch (error) {
      this.#cleanupErrors.push({ action: "staged_input", error });
    }
  }
}
