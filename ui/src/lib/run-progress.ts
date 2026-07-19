import type { WsClientEvent, WsServerEvent } from "../../../server/ws-events.ts";
import {
  applyActivity, completeStep, completeWithDuration, completeWithoutTiming, displayCommand,
  resetStep, settleExecute, settlePlanAndProbe, startStep,
} from "./run-progress-state.ts";

export const RUN_STEPS = ["probe", "plan", "execute", "verify"] as const;
export type RunStepName = typeof RUN_STEPS[number];
export type RunStepStatus = "pending" | "active" | "complete" | "skipped";
export interface RunStep {
  status: RunStepStatus;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  note?: string;
  detail?: string[];
}

export interface RunRequest {
  kind: "task" | "recipe" | "composition";
  description: string;
  files: string[];
}

export interface RunProgress {
  request?: RunRequest;
  steps: Record<RunStepName, RunStep>;
  activity: string;
  command: string;
  commands: string[];
  commandArgv: string[][];
  progress: string;
  commandDurationMs: number;
  commandDurationCount: number;
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
    commands: [], commandArgv: [], progress: "",
    commandDurationMs: 0, commandDurationCount: 0,
  };
}

function copy(state: RunProgress): RunProgress {
  return {
    ...state,
    commands: state.commands.slice(),
    commandArgv: state.commandArgv.map((argv) => [...argv]),
    steps: Object.fromEntries(
      RUN_STEPS.map((name) => {
        const step = state.steps[name];
        return [name, { ...step, detail: step.detail?.slice() }];
      }),
    ) as RunProgress["steps"],
  };
}

export function reduceClientEvent(
  state: RunProgress, event: WsClientEvent,
): RunProgress {
  if (event.type === "confirm_install" || event.type === "deny_install" ||
      event.type === "get_composable_catalog" ||
      event.type === "get_composition_detail") return copy(state);
  const request: RunRequest = event.type === "run_task"
    ? { kind: "task", description: event.task, files: [...event.files] }
    : event.type === "run_composition"
    ? { kind: "composition", description: event.name, files: ["Selected local file"] }
    : "staged_input_id" in event
    ? { kind: "composition", description: event.workflow_id, files: ["Selected local file"] }
    : { kind: "recipe", description: event.workflow_id, files: [...event.files] };
  return createRunProgress(request);
}

export function reduceServerEvent(
  current: RunProgress, event: WsServerEvent, at: number,
): RunProgress {
  if (event.type === "run_started" || event.type === "composition_run_started") {
    const state = createRunProgress(current.request);
    if (event.type === "composition_run_started") {
      state.steps.probe = { status: "skipped" };
      state.steps.plan = { status: "active", startedAt: at };
      state.activity = "Preparing the verified saved-command chain.";
    } else {
      startStep(state, "probe", at);
      state.activity = "Checking saved commands and this Mac.";
    }
    return state;
  }
  const state = copy(current);
  if (event.type === "activity") applyActivity(state, event.message, at);
  if (event.type === "model_call_count" && state.steps.plan.status !== "complete") {
    state.steps.plan.note = `${event.model_calls} model ${event.model_calls === 1 ? "call" : "calls"}`;
  }
  if (event.type === "recipe_matched" || event.type === "workflow_selected") {
    if (state.steps.probe.status === "active") completeStep(state, "probe", at);
    else if (state.steps.probe.status === "pending") {
      state.steps.probe = { status: "skipped" };
    }
    startStep(state, "plan", at);
    state.steps.plan.note = `${event.model_calls} model calls`;
    state.activity = "Saved plan ready. Preparing local execution.";
  }
  if (event.type === "composition_selected") {
    state.steps.probe = { status: "skipped" };
    state.steps.plan = {
      status: "complete", durationMs: 0,
      note: `${event.model_calls} model calls`,
    };
    state.activity = "Saved combined command selected directly.";
  }
  if (event.type === "command_started") {
    settlePlanAndProbe(state, at);
    if (state.steps.verify.status !== "pending") resetStep(state, "verify");
    startStep(state, "execute", at);
    state.command = displayCommand(event.argv);
    state.commands.push(state.command);
    state.commandArgv.push([...event.argv]);
    state.progress = "";
    state.commandStartedAt = at;
  }
  if (event.type === "composition_command_started") {
    settlePlanAndProbe(state, at);
    if (state.steps.verify.status !== "pending") resetStep(state, "verify");
    startStep(state, "execute", at);
    state.command = `Stage ${event.stage_index + 1} · ${event.source_id.replaceAll("-", " ")} · command ${event.command_index + 1}`;
    state.commands.push(state.command);
    state.progress = "";
    state.commandStartedAt = at;
  }
  if (event.type === "command_completed") {
    state.commandDurationMs += Math.max(0, event.duration_ms);
    state.commandDurationCount += 1;
    state.commandStartedAt = undefined;
  }
  if (event.type === "composition_command_completed") {
    state.commandDurationMs += Math.max(0, event.duration_ms);
    state.commandDurationCount += 1;
    state.commandStartedAt = undefined;
  }
  if (event.type === "verification_started") {
    settlePlanAndProbe(state, at);
    settleExecute(state, at);
    if (state.steps.verify.status === "complete") resetStep(state, "verify");
    startStep(state, "verify", at);
    state.activity = "Checking the output against the plan.";
    state.progress = "";
  }
  if (event.type === "composition_verification_started") {
    settlePlanAndProbe(state, at);
    settleExecute(state, at);
    if (state.steps.verify.status === "complete") resetStep(state, "verify");
    startStep(state, "verify", at);
    state.activity = `Verifying stage ${event.stage_index + 1}: ${event.source_id.replaceAll("-", " ")}.`;
  }
  if (event.type === "verification_completed") {
    settlePlanAndProbe(state, at);
    settleExecute(state, at);
    completeWithDuration(state, "verify", at, event.duration_ms);
  }
  if (event.type === "composition_verification_completed") {
    settlePlanAndProbe(state, at);
    settleExecute(state, at);
    if (event.duration_ms !== undefined) {
      completeWithDuration(state, "verify", at, event.duration_ms);
    }
  }
  if (event.type === "check_result") {
    settlePlanAndProbe(state, at);
    settleExecute(state, at);
    if (state.steps.verify.status === "pending") startStep(state, "verify", at);
    state.activity = `Verifying ${event.name}.`;
  }
  if (event.type === "composition_check_result") {
    settlePlanAndProbe(state, at);
    settleExecute(state, at);
    if (state.steps.verify.status === "pending") startStep(state, "verify", at);
    state.activity = `Stage ${event.stage_index + 1}: verifying ${event.name}.`;
  }
  if (event.type === "repair_attempt") state.activity = `Repair attempt ${event.attempt}.`;
  if (event.type === "error") state.activity = event.message;
  if (event.type === "composition_error") state.activity = event.message;
  if ((event.type === "run_complete" || event.type === "composition_run_complete") &&
      event.success) {
    settlePlanAndProbe(state, at);
    settleExecute(state, at);
    if (state.steps.verify.status === "active") completeStep(state, "verify", at);
    else if (state.steps.verify.status === "pending") completeWithoutTiming(state, "verify");
  }
  return state;
}

export function elapsedMs(step: RunStep, now: number): number | undefined {
  if (step.status === "skipped") return undefined;
  if (step.durationMs !== undefined) return step.durationMs;
  if (step.startedAt === undefined) return undefined;
  return Math.max(0, (step.endedAt ?? now) - step.startedAt);
}

export function executeElapsedMs(state: RunProgress, now: number): number {
  return state.commandDurationMs +
    (state.commandStartedAt === undefined ? 0 : Math.max(0, now - state.commandStartedAt));
}
