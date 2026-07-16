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
    expect(() => parseServerEvent('{"type":"shelf_magic"}'))
      .toThrow("unsupported");
    expect(() => parseServerEvent("not json")).toThrow("valid JSON");
  });
});
