import type { ClientEvent, ServerEvent } from "../../../server/ws-events.ts";

export const RUN_STEPS = ["plan", "probe", "execute", "verify"] as const;
export type RunStepName = typeof RUN_STEPS[number];
export type RunStepStatus = "pending" | "active" | "complete";

export interface RunStep {
  status: RunStepStatus;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  note?: string;
  detail?: string[];
}

export interface RunRequest {
  kind: "task" | "recipe";
  description: string;
  files: string[];
}

export interface RunProgress {
  request?: RunRequest;
  steps: Record<RunStepName, RunStep>;
  activity: string;
  command: string;
  commands: string[];
  progress: string;
  commandDurationMs: number;
  commandStartedAt?: number;
}

function emptySteps(): RunProgress["steps"] {
  return {
    plan: { status: "pending" },
    probe: { status: "pending" },
    execute: { status: "pending" },
    verify: { status: "pending" },
  };
}

export function createRunProgress(request?: RunRequest): RunProgress {
  return {
    request, steps: emptySteps(), activity: "", command: "",
    commands: [], progress: "", commandDurationMs: 0,
  };
}

function copy(state: RunProgress): RunProgress {
  return {
    ...state,
    commands: state.commands.slice(),
    steps: Object.fromEntries(
      RUN_STEPS.map((name) => {
        const step = state.steps[name];
        return [name, { ...step, detail: step.detail?.slice() }];
      }),
    ) as RunProgress["steps"],
  };
}

function start(state: RunProgress, name: RunStepName, at: number): void {
  const step = state.steps[name];
  step.startedAt ??= at;
  step.status = "active";
}

function complete(state: RunProgress, name: RunStepName, at: number): void {
  const step = state.steps[name];
  step.startedAt ??= at;
  step.endedAt = at;
  step.durationMs ??= Math.max(0, at - step.startedAt);
  step.status = "complete";
}

export function reduceClientEvent(
  state: RunProgress, event: ClientEvent,
): RunProgress {
  const request: RunRequest = event.type === "run_task"
    ? { kind: "task", description: event.task, files: [...event.files] }
    : { kind: "recipe", description: event.name, files: [...event.files] };
  return createRunProgress(request);
}

function activityEvent(state: RunProgress, message: string, at: number): void {
  state.activity = message;
  if (message.includes("Reading the local system profile")) {
    if (state.steps.plan.status !== "complete") complete(state, "plan", at);
    start(state, "probe", at);
  }
  if (message === "Running the saved recipe locally.") start(state, "probe", at);
  if (message.startsWith("$ ")) {
    if (state.steps.plan.status !== "complete") complete(state, "plan", at);
    if (state.steps.probe.status !== "complete") complete(state, "probe", at);
    if (state.steps.verify.status === "active") state.steps.verify.status = "pending";
    start(state, "execute", at);
    state.command = message.slice(2);
    state.commands.push(state.command);
    state.progress = "";
    state.commandStartedAt = at;
    return;
  }
  const completed = message.match(/^Command exited \d+ in (\d+) ms\.$/);
  if (completed) {
    state.commandDurationMs += Number(completed[1]);
    state.commandStartedAt = undefined;
    return;
  }
  if (/\b(?:frame|time|size)=/.test(message)) {
    state.progress = message;
    return;
  }
  const planNote =
    /^(?:Planning a local command|Asking the model|Plan approved)/.test(message);
  const probeFinding = /system profile|^Found /.test(message) &&
    state.steps.probe.status !== "complete";
  const target = planNote
    ? "plan"
    : probeFinding
    ? "probe"
    : RUN_STEPS.find((name) => state.steps[name].status === "active");
  if (target) {
    const detail = [...(state.steps[target].detail ?? []), message];
    state.steps[target].detail = detail.slice(-6);
  }
}

export function reduceServerEvent(
  current: RunProgress, event: ServerEvent, at: number,
): RunProgress {
  if (event.type === "run_started") {
    const state = createRunProgress(current.request);
    start(state, "plan", at);
    state.activity = "Starting local run.";
    return state;
  }
  const state = copy(current);
  if (event.type === "activity") activityEvent(state, event.message, at);
  if (event.type === "recipe_matched") {
    complete(state, "plan", at);
    state.steps.plan.note = `${event.model_calls} model calls`;
    start(state, "probe", at);
  }
  if (event.type === "check_result") {
    if (state.steps.plan.status !== "complete") complete(state, "plan", at);
    if (state.steps.probe.status !== "complete") complete(state, "probe", at);
    if (state.steps.execute.status !== "complete") {
      complete(state, "execute", at);
      if (state.commandDurationMs > 0) {
        state.steps.execute.durationMs = state.commandDurationMs;
      }
    }
    start(state, "verify", at);
    state.activity = `Verifying ${event.name}.`;
  }
  if (event.type === "repair_attempt") state.activity = `Repair attempt ${event.attempt}.`;
  if (event.type === "error") state.activity = event.message;
  if (event.type === "run_complete" && event.success) {
    if (state.steps.verify.status === "active") complete(state, "verify", at);
    else if (state.steps.execute.status === "active") complete(state, "execute", at);
  }
  return state;
}

export function elapsedMs(step: RunStep, now: number): number | undefined {
  if (step.durationMs !== undefined) return step.durationMs;
  if (step.startedAt === undefined) return undefined;
  return Math.max(0, (step.endedAt ?? now) - step.startedAt);
}

export function executeElapsedMs(state: RunProgress, now: number): number {
  return state.commandDurationMs +
    (state.commandStartedAt === undefined ? 0 : Math.max(0, now - state.commandStartedAt));
}
