export const MAX_EXECUTION_MS = 30 * 60 * 1_000;

export interface ExecutionResult {
  ok: boolean;
  exit_code: number;
  timed_out: boolean;
  duration_ms: number;
  stdout_tail: string;
  stderr_tail: string;
}

export interface PlanExecutionResult extends ExecutionResult {
  command_results: ExecutionResult[];
}

export type ExecutionEvent =
  | { type: "started"; argv: string[] }
  | { type: "stdout" | "stderr"; chunk: string }
  | { type: "completed"; result: ExecutionResult };

export interface ExecutionOptions {
  timeoutMs?: number;
  onEvent?: (event: ExecutionEvent) => void;
  signal?: AbortSignal;
}

export class ExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutionError";
  }
}

export class ExecutionCancelledError extends ExecutionError {
  constructor(message = "Steward execution was cancelled", options?: ErrorOptions) {
    super(message);
    this.name = "ExecutionCancelledError";
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}
