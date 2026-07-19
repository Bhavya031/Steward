import type { CompositionRuntimeEvent } from "./composition-runtime.ts";
import type { EmitWsEvent } from "./ws-events.ts";

export function redactPrivatePaths(value: string): string {
  return value.replace(
    /(^|[\s"'=])\/[^ \t\r\n"',;]+/g,
    (_match, prefix: string) => `${prefix}[private path]`,
  );
}

export function publicCompositionError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactPrivatePaths(message.trim() || fallback);
}

export function compositionRuntimeEvents(
  runId: string,
  emit: EmitWsEvent,
): (event: CompositionRuntimeEvent) => void {
  const nextCommand = new Map<number, number>();
  const activeCommand = new Map<number, number>();
  return (event) => {
    if (event.type === "stage_started") {
      emit({
        type: "composition_stage_started", run_id: runId,
        stage_index: event.stage_index, source_id: event.source_id,
      });
      event.check_names.forEach((name) => emit({
        type: "composition_check_pending", run_id: runId,
        stage_index: event.stage_index, source_id: event.source_id, name,
      }));
      return;
    }
    if (event.type === "execution") {
      if (event.event.type === "started") {
        const index = nextCommand.get(event.stage_index) ?? 0;
        nextCommand.set(event.stage_index, index + 1);
        activeCommand.set(event.stage_index, index);
        emit({
          type: "composition_command_started", run_id: runId,
          stage_index: event.stage_index, source_id: event.source_id,
          command_index: index,
        });
      } else if (event.event.type === "completed") {
        const index = activeCommand.get(event.stage_index) ??
          Math.max(0, (nextCommand.get(event.stage_index) ?? 1) - 1);
        activeCommand.delete(event.stage_index);
        emit({
          type: "composition_command_completed", run_id: runId,
          stage_index: event.stage_index, source_id: event.source_id,
          command_index: index, exit_code: event.event.result.exit_code,
          duration_ms: event.event.result.duration_ms,
        });
      }
      return;
    }
    if (event.type === "verification_started") {
      emit({
        type: "composition_verification_started", run_id: runId,
        stage_index: event.stage_index, source_id: event.source_id,
      });
      return;
    }
    if (event.type === "verification_completed") {
      emit({
        type: "composition_verification_completed", run_id: runId,
        stage_index: event.stage_index, source_id: event.source_id,
        duration_ms: event.duration_ms,
      });
      return;
    }
    emit({
      type: "composition_check_result", run_id: runId,
      stage_index: event.result.stage_index, source_id: event.result.source_id,
      name: event.result.name, pass: event.result.pass,
      expected: redactPrivatePaths(event.result.expected),
      actual: redactPrivatePaths(event.result.actual),
    });
  };
}
