import type { ClientEvent } from "../../../server/ws-events.ts";
import { sessionTokenFromUrl } from "./ws.ts";

export const EXAMPLE_TASKS = [
  "Compress this video under 25 MB",
  "Convert this to MP4",
  "Make this PDF searchable",
] as const;

export type RunTaskEvent = Extract<ClientEvent, { type: "run_task" }>;
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

export async function stageInputFile(
  file: File,
  pageUrl = new URL(window.location.href),
  fetcher: Fetcher = fetch,
): Promise<string> {
  const token = sessionTokenFromUrl(pageUrl);
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
  return (result as { path: string }).path;
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
