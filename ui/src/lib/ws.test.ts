import { describe, expect, test } from "bun:test";
import { parseServerEvent, sessionTokenFromUrl } from "./ws.ts";

describe("browser WebSocket client", () => {
  test("takes the session token from the startup URL", () => {
    expect(sessionTokenFromUrl(new URL("http://127.0.0.1:1234/?token=session-123")))
      .toBe("session-123");
    expect(() => sessionTokenFromUrl(new URL("http://127.0.0.1:1234/")))
      .toThrow("Session token is missing");
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
    expect(() => parseServerEvent('{"type":"shelf_magic"}'))
      .toThrow("unsupported");
    expect(() => parseServerEvent("not json")).toThrow("valid JSON");
  });
});
