import type { CompositionRun } from "./composition-runtime.ts";

export interface CleanupFailure {
  action: string;
  error: unknown;
}

export interface CleanupAction {
  action: string;
  run: () => void;
}

export interface PrimaryFailure {
  error: unknown;
}

export class CompositionRunFailureError extends Error {
  constructor(public readonly run: CompositionRun) {
    const stage = run.stages.at(-1);
    const reason = stage?.execution.ok ? "verification" : "execution";
    super(`composition ${reason} failed at stage ${run.failed_stage ?? "unknown"}`);
    this.name = "CompositionRunFailureError";
  }
}

export class CompositionCleanupError extends AggregateError {
  readonly hasPrimaryError: boolean;
  readonly primaryError: unknown;
  readonly cleanupErrors: CleanupFailure[];

  constructor(primaryFailure: PrimaryFailure | null, cleanupErrors: CleanupFailure[]) {
    const primaryError = primaryFailure?.error;
    const recorded = [
      ...(primaryFailure ? [primaryError] : []),
      ...cleanupErrors.map(({ error }) => error),
    ];
    super(recorded, "composition failed while cleanup was incomplete", {
      cause: primaryFailure ? primaryError : cleanupErrors[0]?.error,
    });
    this.name = "CompositionCleanupError";
    this.hasPrimaryError = primaryFailure !== null;
    this.primaryError = primaryError;
    this.cleanupErrors = cleanupErrors;
  }
}

export function finalizeCompositionRun(
  run: CompositionRun | undefined,
  primaryFailure: PrimaryFailure | null,
  actions: CleanupAction[],
): CompositionRun {
  const cleanupErrors: CleanupFailure[] = [];
  for (const action of actions) {
    try {
      action.run();
    } catch (error) {
      cleanupErrors.push({ action: action.action, error });
    }
  }
  const primary = primaryFailure ??
    (run && !run.success && cleanupErrors.length > 0
      ? { error: new CompositionRunFailureError(run) }
      : null);
  if (cleanupErrors.length > 0) throw new CompositionCleanupError(primary, cleanupErrors);
  if (primaryFailure) throw primaryFailure.error;
  if (!run) throw new Error("composition completed without a result");
  return run;
}
