import { describe, expect, test } from "bun:test";
import { userFacingMessage } from "./user-facing.ts";

describe("user-facing saved-workflow language", () => {
  test("does not expose internal storage terminology", () => {
    expect(userFacingMessage(new Error("recipe JSON is invalid in recipes directory")))
      .toBe("saved workflow JSON is invalid in saved workflows directory");
    expect(userFacingMessage("Recipe rerun failed")).toBe("saved workflow rerun failed");
    expect(userFacingMessage("ready")).toBe("ready");
  });
});
