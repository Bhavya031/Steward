import { beforeEach, describe, expect, test } from "bun:test";
import {
  EXAMPLE_TASKS, canSubmitTask, filesFromDrop, filesFromPicker,
  populateTaskFromExample, runCompositionEvent, runSavedCompositionEvent,
  runSavedWorkflowEvent, runTaskEvent, stageCompositionFile, stageInputFile,
  submitComposition, submitSavedComposition, submitSavedWorkflow, submitTask,
} from "./task-entry.ts";
import { captureStartupSession, resetSessionAuthForTests } from "./ws.ts";

const video = new File(["video bytes"], "clip one.mov", { type: "video/quicktime" });
const document = new File(["pdf bytes"], "scan.pdf", { type: "application/pdf" });
const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
};

describe("visible task entry", () => {
  beforeEach(() => resetSessionAuthForTests());
  test("turns typed task text and staged selections into the exact run_task payload", async () => {
    const staged: string[] = [];
    const event = await submitTask("  Convert this to MP4  ", [video, document], async (file) => {
      staged.push(await file.text());
      return `/tmp/steward-inputs-proof/${file.name.replaceAll(" ", "_")}`;
    });
    expect(staged).toEqual(["video bytes", "pdf bytes"]);
    expect(event).toEqual({
      type: "run_task",
      task: "Convert this to MP4",
      files: [
        "/tmp/steward-inputs-proof/clip_one.mov",
        "/tmp/steward-inputs-proof/scan.pdf",
      ],
    });
  });

  test("accepts file picker and drag-and-drop FileList-shaped selections", () => {
    const source = { 0: video, 1: document, length: 2 };
    expect(filesFromPicker(source)).toEqual([video, document]);
    expect(filesFromDrop({ files: source as unknown as FileList })).toEqual([video, document]);
    expect(filesFromPicker(null)).toEqual([]);
    expect(filesFromDrop(null)).toEqual([]);
  });

  test("example chips populate the task text verbatim", () => {
    expect(EXAMPLE_TASKS.map(populateTaskFromExample)).toEqual([
      "Compress this video under 25 MB",
      "Convert this to MP4",
      "Make this PDF searchable",
    ]);
  });

  test("keeps blank, fileless, and busy submissions disabled", async () => {
    expect(canSubmitTask("", [video], false)).toBe(false);
    expect(canSubmitTask("   ", [video], false)).toBe(false);
    expect(canSubmitTask("Convert this", [], false)).toBe(false);
    expect(canSubmitTask("Convert this", [video], true)).toBe(false);
    expect(canSubmitTask("Convert this", [video], false)).toBe(true);
    expect(() => runTaskEvent("", ["/tmp/file.mov"])).toThrow();
    expect(() => runTaskEvent("Convert", [])).toThrow();
    await expect(submitTask("Convert", [])).rejects.toThrow("choose at least one file");
  });

  test("stages browser bytes with the startup token and encoded filename", async () => {
    const storage = memoryStorage();
    let cleanUrl = "";
    captureStartupSession(
      new URL("http://127.0.0.1:4321/?token=session-secret&__proof_task=convert"),
      storage,
      (value) => { cleanUrl = value; },
    );
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const path = await stageInputFile(
      video,
      new URL("http://127.0.0.1:4321/?__proof_task=convert"),
      async (input, init) => {
        capturedUrl = String(input);
        capturedInit = init;
        return Response.json({ path: "/tmp/steward-inputs-proof/unique-clip.mov" }, {
          status: 201,
        });
      },
    );
    expect(capturedUrl).toBe(
      "http://127.0.0.1:4321/api/stage-input?token=session-secret",
    );
    expect(cleanUrl).toBe("/?__proof_task=convert");
    expect(capturedInit?.method).toBe("POST");
    const headers = new Headers(capturedInit?.headers);
    expect(headers.get("x-steward-filename")).toBe("clip%20one.mov");
    expect(await new Response(capturedInit?.body).text()).toBe("video bytes");
    expect(path).toBe("/tmp/steward-inputs-proof/unique-clip.mov");
  });

  test("stages a newly chosen file for a stable-ID direct rerun", async () => {
    const staged: string[] = [];
    const event = await submitSavedWorkflow(
      "convert-media-to-mp4",
      [video],
      async (file) => {
        staged.push(file.name);
        return "/tmp/steward-inputs-proof/new-clip.mov";
      },
    );
    expect(staged).toEqual(["clip one.mov"]);
    expect(event).toEqual({
      type: "run_saved_workflow",
      workflow_id: "convert-media-to-mp4",
      files: ["/tmp/steward-inputs-proof/new-clip.mov"],
    });
    expect(() => runSavedWorkflowEvent("../escape", ["/tmp/input.mov"])).toThrow();
    expect(() => runSavedWorkflowEvent("convert-media-to-mp4", [])).toThrow();
  });

  test("sends only the locked composition request after one-file ID staging", async () => {
    const stagedId = "d9428888-122b-4e7f-a15b-3f708bc090f1";
    const event = await submitComposition(
      "media-chain",
      ["convert-media-to-mp4", "transcribe-video-to-srt"],
      [video],
      async () => stagedId,
    );
    expect(event).toEqual({
      type: "run_composition",
      name: "media-chain",
      workflow_ids: ["convert-media-to-mp4", "transcribe-video-to-srt"],
      staged_input_id: stagedId,
    });
    expect(Object.keys(event)).toEqual([
      "type", "name", "workflow_ids", "staged_input_id",
    ]);
    expect(JSON.stringify(event)).not.toContain("/tmp/");
    expect(() => runCompositionEvent(
      "Media Chain", ["one-command", "two-command"], stagedId,
    )).toThrow();
    await expect(submitComposition(
      "media-chain", ["one-command", "two-command"], [video, document],
      async () => stagedId,
    )).rejects.toThrow("exactly one");
  });

  test("stages a one-shot ID for composition Do Again without a path", async () => {
    const stagedId = "a9428888-122b-4e7f-a15b-3f708bc090f1";
    const event = await submitSavedComposition(
      "media-chain", [video], async () => stagedId,
    );
    expect(event).toEqual({
      type: "run_saved_workflow",
      workflow_id: "media-chain",
      staged_input_id: stagedId,
    });
    expect(() => runSavedCompositionEvent("../escape", stagedId)).toThrow();
  });

  test("extracts only the opaque ID for a composed run", async () => {
    const storage = memoryStorage();
    captureStartupSession(
      new URL("http://127.0.0.1:4321/?token=composition-session"),
      storage,
      () => undefined,
    );
    const stagedId = "b9428888-122b-4e7f-a15b-3f708bc090f1";
    const value = await stageCompositionFile(
      video,
      new URL("http://127.0.0.1:4321/"),
      async () => Response.json({
        path: "/private/tmp/steward-inputs/hidden.mov",
        staged_input_id: stagedId,
      }, { status: 201 }),
    );
    expect(value).toBe(stagedId);
    expect(value).not.toContain("private");
  });
});
