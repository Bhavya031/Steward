import type { ClientEvent, WsClientEvent } from "../../../server/ws-events.ts";
import { canonicalCompositionName } from "./composition-flow.ts";
import { sessionTokenForRequest } from "./ws.ts";

export const EXAMPLE_TASKS = [
  "Compress this video under 25 MB",
  "Convert this to MP4",
  "Make this PDF searchable",
] as const;

export type RunTaskEvent = Extract<ClientEvent, { type: "run_task" }>;
export type RunSavedWorkflowEvent = Extract<ClientEvent, { type: "run_saved_workflow" }>;
export type RunCompositionEvent = Extract<WsClientEvent, { type: "run_composition" }>;
export type RunSavedCompositionEvent = Extract<
  WsClientEvent, { type: "run_saved_workflow"; staged_input_id: string }
>;
type FileSource = ArrayLike<File> | null | undefined;
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function copiedFiles(source: FileSource): File[] {
  return source ? Array.from(source) : [];
}

export function filesFromPicker(source: FileSource): File[] {
  return copiedFiles(source);
}

export function filesFromDrop(transfer: Pick<DataTransfer, "files"> | null): File[] {
  return copiedFiles(transfer?.files);
}

export function populateTaskFromExample(example: typeof EXAMPLE_TASKS[number]): string {
  return example;
}

export function canSubmitTask(task: string, files: File[], busy: boolean): boolean {
  return task.trim().length > 0 && files.length > 0 && !busy;
}

export function runTaskEvent(task: string, paths: string[]): RunTaskEvent {
  const normalized = task.trim();
  if (!normalized || paths.length === 0 || paths.some((path) => !path.startsWith("/"))) {
    throw new Error("A task and at least one staged file are required.");
  }
  return { type: "run_task", task: normalized, files: [...paths] };
}

export function runSavedWorkflowEvent(
  workflowId: string,
  paths: string[],
): RunSavedWorkflowEvent {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(workflowId) || workflowId.length > 64 ||
      paths.length === 0 || paths.some((path) => !path.startsWith("/"))) {
    throw new Error("A saved workflow and at least one staged file are required.");
  }
  return { type: "run_saved_workflow", workflow_id: workflowId, files: [...paths] };
}

export async function stageInputFile(
  file: File,
  pageUrl = new URL(window.location.href),
  fetcher: Fetcher = fetch,
): Promise<string> {
  return (await stageInput(file, pageUrl, fetcher)).path;
}

async function stageInput(
  file: File,
  pageUrl: URL,
  fetcher: Fetcher,
): Promise<{ path: string; stagedInputId?: string }> {
  const token = sessionTokenForRequest(pageUrl);
  const url = new URL("/api/stage-input", pageUrl);
  url.search = "";
  url.searchParams.set("token", token);
  const response = await fetcher(url, {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-Steward-Filename": encodeURIComponent(file.name),
    },
    body: file,
  });
  const result: unknown = await response.json();
  if (!response.ok || typeof result !== "object" || result === null ||
      !Object.hasOwn(result, "path") ||
      typeof (result as { path?: unknown }).path !== "string") {
    const message = typeof result === "object" && result !== null &&
      Object.hasOwn(result, "error") && typeof (result as { error?: unknown }).error === "string"
      ? (result as { error: string }).error
      : "Steward could not stage the selected file.";
    throw new Error(message);
  }
  const stagedInputId = Object.hasOwn(result, "staged_input_id") &&
    typeof (result as { staged_input_id?: unknown }).staged_input_id === "string"
    ? (result as { staged_input_id: string }).staged_input_id : undefined;
  return { path: (result as { path: string }).path, stagedInputId };
}

export async function stageCompositionFile(
  file: File,
  pageUrl = new URL(window.location.href),
  fetcher: Fetcher = fetch,
): Promise<string> {
  const staged = await stageInput(file, pageUrl, fetcher);
  if (!staged.stagedInputId) {
    throw new Error("Steward did not issue a saved-command input ID.");
  }
  return staged.stagedInputId;
}

export async function submitTask(
  task: string,
  files: File[],
  stage: (file: File) => Promise<string> = stageInputFile,
): Promise<RunTaskEvent> {
  if (!canSubmitTask(task, files, false)) {
    throw new Error("Enter a task and choose at least one file.");
  }
  const paths: string[] = [];
  for (const file of files) paths.push(await stage(file));
  return runTaskEvent(task, paths);
}

export async function submitSavedWorkflow(
  workflowId: string,
  files: File[],
  stage: (file: File) => Promise<string> = stageInputFile,
): Promise<RunSavedWorkflowEvent> {
  if (files.length === 0) throw new Error("Choose at least one new file.");
  const paths: string[] = [];
  for (const file of files) paths.push(await stage(file));
  return runSavedWorkflowEvent(workflowId, paths);
}

export function runCompositionEvent(
  name: string, workflowIds: string[], stagedInputId: string,
): RunCompositionEvent {
  const canonical = canonicalCompositionName(name);
  if (!canonical || workflowIds.length < 2 || workflowIds.length > 8 ||
      new Set(workflowIds).size !== workflowIds.length ||
      !workflowIds.every((id) => canonicalCompositionName(id) === id) ||
      !/^[0-9a-f-]{36}$/.test(stagedInputId)) {
    throw new Error("A canonical name, 2–8 saved commands, and one staged file are required.");
  }
  return {
    type: "run_composition", name: canonical,
    workflow_ids: [...workflowIds], staged_input_id: stagedInputId,
  };
}

export function runSavedCompositionEvent(
  workflowId: string, stagedInputId: string,
): RunSavedCompositionEvent {
  if (canonicalCompositionName(workflowId) !== workflowId ||
      !/^[0-9a-f-]{36}$/.test(stagedInputId)) {
    throw new Error("A saved combined command and one staged file are required.");
  }
  return { type: "run_saved_workflow", workflow_id: workflowId, staged_input_id: stagedInputId };
}

export async function submitComposition(
  name: string, workflowIds: string[], files: File[],
  stage: (file: File) => Promise<string> = stageCompositionFile,
): Promise<RunCompositionEvent> {
  if (files.length !== 1) throw new Error("Choose exactly one file.");
  return runCompositionEvent(name, workflowIds, await stage(files[0]!));
}

export async function submitSavedComposition(
  workflowId: string, files: File[],
  stage: (file: File) => Promise<string> = stageCompositionFile,
): Promise<RunSavedCompositionEvent> {
  if (files.length !== 1) throw new Error("Choose exactly one new file.");
  return runSavedCompositionEvent(workflowId, await stage(files[0]!));
}
