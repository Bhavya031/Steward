import type { RunProgress, RunStepName } from "./run-progress.ts";

const STEP_NAMES: RunStepName[] = ["plan", "probe", "execute", "verify"];

export function startStep(state: RunProgress, name: RunStepName, at: number): void {
  const step = state.steps[name];
  step.startedAt ??= at;
  step.status = "active";
}

export function completeStep(state: RunProgress, name: RunStepName, at: number): void {
  const step = state.steps[name];
  step.startedAt ??= at;
  step.endedAt = at;
  step.durationMs ??= Math.max(0, at - step.startedAt);
  step.status = "complete";
}

export function completeWithoutTiming(state: RunProgress, name: RunStepName): void {
  state.steps[name] = { status: "complete" };
}

export function completeWithDuration(
  state: RunProgress, name: RunStepName, at: number, durationMs: number,
): void {
  const step = state.steps[name];
  step.startedAt ??= at;
  step.endedAt = at;
  step.durationMs = Math.max(0, durationMs);
  step.status = "complete";
}

export function resetStep(state: RunProgress, name: RunStepName): void {
  state.steps[name] = { status: "pending" };
}

export function settlePlanAndProbe(state: RunProgress, at: number): void {
  if (state.steps.plan.status === "pending" || state.steps.plan.status === "active") {
    completeStep(state, "plan", at);
  }
  if (state.steps.probe.status === "active") completeStep(state, "probe", at);
  else if (state.steps.probe.status === "pending") {
    state.steps.probe = { status: "skipped" };
  }
}

export function settleExecute(state: RunProgress, at: number): void {
  if (state.steps.execute.status === "pending") {
    completeWithoutTiming(state, "execute");
  } else if (state.steps.execute.status === "active") {
    completeStep(state, "execute", at);
    if (state.commandDurationCount > 0) {
      state.steps.execute.durationMs = state.commandDurationMs;
    }
  }
}

function displayArgument(argument: string): string {
  return /^[A-Za-z0-9_./:=+{},-]+$/.test(argument) ? argument : JSON.stringify(argument);
}

export function displayCommand(argv: string[]): string {
  return argv.map(displayArgument).join(" ");
}

export function applyActivity(state: RunProgress, message: string, at: number): void {
  state.activity = message;
  if (message.includes("Reading the local system profile")) {
    if (state.steps.plan.status !== "complete") completeStep(state, "plan", at);
    startStep(state, "probe", at);
  }
  if (message.startsWith("$ ") || /^Command exited \d+ in \d+ ms\.$/.test(message)) return;
  if (/\b(?:frame|time|size)=|progress\s*=\s*\d+%/i.test(message)) {
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
    : STEP_NAMES.find((name) => state.steps[name].status === "active");
  if (target) {
    const detail = [...(state.steps[target].detail ?? []), message];
    state.steps[target].detail = detail.slice(-6);
  }
}
