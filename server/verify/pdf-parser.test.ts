import { describe, expect, test } from "bun:test";
import { parseGhostscriptPageCount } from "./pdf.ts";

const GHOSTSCRIPT_SAMPLE = `
GPL Ghostscript 10.06.0
Processing pages 1 through 12.
Page 1
12
`;

describe("Ghostscript page-count parser", () => {
  test("takes the final integer from captured mixed output", () => {
    expect(parseGhostscriptPageCount(GHOSTSCRIPT_SAMPLE)).toBe(12);
  });

  test("accepts quiet-mode output", () => {
    expect(parseGhostscriptPageCount("1\n")).toBe(1);
  });

  test("fails if no objective count was emitted", () => {
    expect(() => parseGhostscriptPageCount("processing complete")).toThrow(
      "Ghostscript returned no page count",
    );
  });
});
