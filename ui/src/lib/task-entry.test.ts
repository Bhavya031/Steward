import { describe, expect, test } from "bun:test";
import {
  EXAMPLE_TASKS, canSubmitTask, filesFromDrop, filesFromPicker,
  populateTaskFromExample, runTaskEvent, stageInputFile, submitTask,
} from "./task-entry.ts";

const video = new File(["video bytes"], "clip one.mov", { type: "video/quicktime" });
const document = new File(["pdf bytes"], "scan.pdf", { type: "application/pdf" });

describe("visible task entry", () => {
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
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const path = await stageInputFile(
      video,
      new URL("http://127.0.0.1:4321/?token=session-secret"),
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
    expect(capturedInit?.method).toBe("POST");
    const headers = new Headers(capturedInit?.headers);
    expect(headers.get("x-steward-filename")).toBe("clip%20one.mov");
    expect(await new Response(capturedInit?.body).text()).toBe("video bytes");
    expect(path).toBe("/tmp/steward-inputs-proof/unique-clip.mov");
  });
});
