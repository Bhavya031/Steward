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
}

export class ExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutionError";
  }
}
