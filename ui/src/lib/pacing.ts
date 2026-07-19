import type { WsServerEvent } from "../../../server/ws-events.ts";

export const STEP_GAP_MS = 1_000;

function advancesStep(event: WsServerEvent): boolean {
  if (event.type === "recipe_matched" || event.type === "workflow_selected" ||
      event.type === "command_started" ||
      event.type === "verification_started" || event.type === "run_complete" ||
      event.type === "composition_stage_started" ||
      event.type === "composition_command_started" ||
      event.type === "composition_verification_started" ||
      event.type === "composition_run_complete") return true;
  if (event.type !== "activity") return false;
  return event.message.startsWith("Planning a local command") ||
    event.message.startsWith("Plan ready.");
}

export interface Pacer {
  push(event: WsServerEvent): void;
  reset(): void;
}

export function createPacer(
  dispatch: (event: WsServerEvent, receivedAt: number) => void,
  gapMs = STEP_GAP_MS,
): Pacer {
  let queue: Array<{ event: WsServerEvent; at: number }> = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastStepAt = 0;

  function pump(): void {
    while (queue.length > 0) {
      const head = queue[0];
      const now = Date.now();
      if (advancesStep(head.event)) {
        const due = lastStepAt + gapMs;
        if (now < due) {
          timer ??= setTimeout(() => {
            timer = undefined;
            pump();
          }, due - now);
          return;
        }
        lastStepAt = now;
      }
      queue.shift();
      dispatch(head.event, head.at);
    }
  }

  function reset(): void {
    queue = [];
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    lastStepAt = 0;
  }

  return {
    reset,
    push(event: WsServerEvent): void {
      if (event.type === "run_started" || event.type === "composition_run_started") {
        reset();
        lastStepAt = Date.now();
      }
      queue.push({ event, at: Date.now() });
      pump();
    },
  };
}
