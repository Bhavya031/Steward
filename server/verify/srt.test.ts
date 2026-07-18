import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectSrt } from "./srt.ts";
import { verifyChecks } from "./index.ts";
import { probeSystem } from "../probe.ts";

const root = mkdtempSync(join(tmpdir(), "steward-srt-"));
const output = join(root, "captions.srt");
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("SRT verification", () => {
  test("measures valid cues and monotonic timestamps with objective evidence", async () => {
    writeFileSync(output, [
      "1", "00:00:00,000 --> 00:00:01,200", "First cue.", "",
      "2", "00:00:01,100 --> 00:00:02,500", "Second cue.", "",
    ].join("\n"));
    const results = await verifyChecks([
      { type: "srt_valid", target: true },
      { type: "cue_count", target: 1 },
      { type: "timestamps_monotonic", target: true },
    ], { outputPath: output, sourcePaths: [], profile: probeSystem() });
    expect(results).toEqual([
      {
        name: "srt_valid", pass: true,
        expected: "valid UTF-8 SRT with sequential non-empty cues",
        actual: "2 structurally valid cues",
      },
      { name: "cue_count", pass: true, expected: "at least 1 cue", actual: "2 cues" },
      {
        name: "timestamps_monotonic", pass: true,
        expected: "cue timestamps are nondecreasing and every end follows its start",
        actual: "2 cues; timestamps monotonic",
      },
    ]);
  });

  test("rejects malformed and out-of-order cues", () => {
    writeFileSync(output, [
      "1", "00:00:02,000 --> 00:00:03,000", "Later.", "",
      "2", "00:00:01,000 --> 00:00:01,500", "Earlier.", "",
    ].join("\n"));
    expect(inspectSrt(output)).toMatchObject({ valid: true, monotonic: false });
    writeFileSync(output, "1\nnot a timestamp\ntext\n");
    expect(inspectSrt(output)).toMatchObject({ valid: false, error: "cue 1 is malformed" });
  });
});
