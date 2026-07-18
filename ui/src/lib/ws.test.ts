import { beforeEach, describe, expect, test } from "bun:test";
import {
  captureStartupSession, parseServerEvent, resetSessionAuthForTests,
  sessionTokenForRequest, sessionTokenFromUrl,
} from "./ws.ts";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe("browser WebSocket client", () => {
  beforeEach(() => resetSessionAuthForTests());
  test("takes the session token from the startup URL", () => {
    expect(sessionTokenFromUrl(new URL("http://127.0.0.1:1234/?token=session-123")))
      .toBe("session-123");
    expect(() => sessionTokenFromUrl(new URL("http://127.0.0.1:1234/")))
      .toThrow("Session token is missing");
  });

  test("captures the token once, keeps proof parameters, and removes it from the visible URL", () => {
    const storage = memoryStorage();
    const replacements: string[] = [];
    const token = captureStartupSession(
      new URL(
        "http://127.0.0.1:1234/?token=session-123&__proof_task=convert&__proof_file=%2Ftmp%2Fa.mov#result",
      ),
      storage,
      (url) => replacements.push(url),
    );
    expect(token).toBe("session-123");
    expect(sessionTokenForRequest()).toBe("session-123");
    expect(replacements).toEqual([
      "/?__proof_task=convert&__proof_file=%2Ftmp%2Fa.mov#result",
    ]);
    expect(replacements[0]).not.toContain("session-123");

    expect(captureStartupSession(
      new URL("http://127.0.0.1:1234/?__proof_task=convert"),
      storage,
      (url) => replacements.push(url),
    )).toBe("session-123");
    expect(replacements).toHaveLength(1);
  });

  test("does not let a later URL replace the captured browser-session token", () => {
    const storage = memoryStorage();
    captureStartupSession(
      new URL("http://127.0.0.1:1234/?token=session-123"),
      storage,
      () => undefined,
    );
    expect(() => captureStartupSession(
      new URL("http://127.0.0.1:1234/?token=attacker"),
      storage,
      () => undefined,
    )).toThrow("does not match");
  });

  test("accepts registered server events and rejects unknown types", () => {
    expect(parseServerEvent('{"type":"check_result","run_id":"r1","name":"plays","pass":true,"expected":"decode","actual":"ok"}'))
      .toMatchObject({ type: "check_result", name: "plays", pass: true });
    expect(parseServerEvent('{"type":"command_completed","run_id":"r1","exit_code":0,"duration_ms":417}'))
      .toMatchObject({ type: "command_completed", duration_ms: 417 });
    expect(parseServerEvent('{"type":"verification_completed","run_id":"r1","duration_ms":81}'))
      .toMatchObject({ type: "verification_completed", duration_ms: 81 });
    expect(parseServerEvent('{"type":"model_call_count","run_id":"r1","model_calls":1}'))
      .toMatchObject({ type: "model_call_count", model_calls: 1 });
    expect(parseServerEvent('{"type":"workflow_catalog","workflows":[]}'))
      .toEqual({ type: "workflow_catalog", workflows: [] });
    expect(parseServerEvent('{"type":"workflow_selected","run_id":"r1","workflow_id":"convert-media-to-mp4","model_calls":0}'))
      .toMatchObject({ type: "workflow_selected", model_calls: 0 });
    expect(() => parseServerEvent('{"type":"shelf_magic"}'))
      .toThrow("unsupported");
    expect(() => parseServerEvent("not json")).toThrow("valid JSON");
  });
});
