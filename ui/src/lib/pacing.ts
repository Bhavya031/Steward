import type { ServerEvent } from "../../../server/ws-events.ts";

export const STEP_GAP_MS = 1_000;

function advancesStep(event: ServerEvent): boolean {
  if (event.type === "recipe_matched" || event.type === "command_started" ||
      event.type === "verification_started" || event.type === "run_complete") return true;
  if (event.type !== "activity") return false;
  return event.message.startsWith("Planning a local command") ||
    event.message.startsWith("Plan ready.");
}

export interface Pacer {
  push(event: ServerEvent): void;
}

export function createPacer(
  dispatch: (event: ServerEvent, receivedAt: number) => void,
  gapMs = STEP_GAP_MS,
): Pacer {
  let queue: Array<{ event: ServerEvent; at: number }> = [];
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

  return {
    push(event: ServerEvent): void {
      if (event.type === "run_started") {
        queue = [];
        if (timer) {
          clearTimeout(timer);
          timer = undefined;
        }
        lastStepAt = Date.now();
      }
      queue.push({ event, at: Date.now() });
      pump();
    },
  };
}
