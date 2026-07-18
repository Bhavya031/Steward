import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  installResource, resourcePath, TRUSTED_RESOURCES,
} from "./trusted-resources.ts";

let root = "";
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  delete process.env.STEWARD_RESOURCE_DIR;
});

describe("trusted model installation", () => {
  test("pins the official large-v3-turbo size and SHA-256", () => {
    expect(TRUSTED_RESOURCES["whisper-large-v3-turbo"]).toMatchObject({
      bytes: 1_624_555_275,
      sha256: "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69",
      source: "ggerganov/whisper.cpp",
    });
  });

  test("discards a partial or substituted download before it becomes trusted", async () => {
    root = mkdtempSync(join(tmpdir(), "steward-resource-"));
    process.env.STEWARD_RESOURCE_DIR = root;
    const fetcher = async () => new Response(new Uint8Array([1, 2, 3]));
    await expect(installResource(
      "whisper-large-v3-turbo", () => undefined, fetcher,
    )).rejects.toThrow("model size mismatch");
    expect(existsSync(resourcePath("whisper-large-v3-turbo"))).toBe(false);
    expect(existsSync(`${resourcePath("whisper-large-v3-turbo")}.download`)).toBe(false);
  });
});
