import { ExecutionCancelledError } from "./execution-types.ts";

const GRACEFUL_EXIT_MS = 100;
const FORCED_EXIT_MS = 300;

interface OwnedChild {
  exited: Promise<number>;
  kill(signal?: number): void;
}

function bounded(completion: Promise<unknown>, milliseconds: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (completed: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(completed);
    };
    const timer = setTimeout(() => finish(false), milliseconds);
    void completion.then(() => finish(true), () => finish(true));
  });
}

export function stewardCancellation(signal: AbortSignal): ExecutionCancelledError {
  if (signal.reason instanceof ExecutionCancelledError) return signal.reason;
  return new ExecutionCancelledError("Steward execution was cancelled", {
    cause: signal.reason,
  });
}

export function throwIfStewardCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw stewardCancellation(signal);
}

export class OwnedProcessCancellation {
  readonly aborted: Promise<ExecutionCancelledError>;
  #resolveAbort!: (error: ExecutionCancelledError) => void;
  #reason?: ExecutionCancelledError;
  #readers: Array<(reason: unknown) => void> = [];
  #exit: Promise<unknown>;
  #abort: () => void;

  constructor(
    private readonly child: OwnedChild,
    private readonly signal: AbortSignal | undefined,
  ) {
    this.#exit = child.exited.then(() => undefined, () => undefined);
    this.aborted = new Promise((resolve) => {
      this.#resolveAbort = resolve;
    });
    this.#abort = () => {
      if (this.#reason) return;
      this.#reason = this.signal
        ? stewardCancellation(this.signal)
        : new ExecutionCancelledError();
      for (const cancel of this.#readers) cancel(this.#reason);
      try {
        this.child.kill();
      } catch {
        // Reaping below remains authoritative when the child already exited.
      }
      this.#resolveAbort(this.#reason);
    };
    signal?.addEventListener("abort", this.#abort, { once: true });
  }

  addReader(cancel: (reason: unknown) => void): void {
    this.#readers.push(cancel);
    if (this.#reason) cancel(this.#reason);
  }

  async settleAbort(): Promise<ExecutionCancelledError> {
    const reason = this.#reason ?? await this.aborted;
    if (!await bounded(this.#exit, GRACEFUL_EXIT_MS)) {
      try {
        this.child.kill(9);
      } catch {
        // The child may have exited between the bounded wait and force-kill.
      }
      await bounded(this.#exit, FORCED_EXIT_MS);
    }
    return reason;
  }

  dispose(): void {
    this.signal?.removeEventListener("abort", this.#abort);
    this.#readers = [];
  }
}
