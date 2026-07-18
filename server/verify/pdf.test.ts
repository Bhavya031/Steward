import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecutionEvent } from "../executor.ts";
import { probeSystem } from "../probe.ts";
import { writePdf } from "../test-fixtures.ts";
import { verifyChecks, type VerificationContext } from "./index.ts";

const root = mkdtempSync(join(tmpdir(), "steward-pdf-verify-"));
const profile = probeSystem();
const realPdf = join(root, "searchable.pdf");
const textlessPdf = join(root, "textless.pdf");
const fakePdf = join(root, "fake.pdf");
const brokenPdf = join(root, "broken.pdf");
const empty = join(root, "empty.txt");

beforeAll(() => {
  writePdf(realPdf, "Steward searchable document verification text");
  writePdf(textlessPdf, null);
  writeFileSync(fakePdf, "plain UTF-8 text wearing a PDF extension");
  writeFileSync(brokenPdf, "%PDF-1.7\nthis is not a PDF structure");
  writeFileSync(empty, "");
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

function context(
  outputPath: string,
  onExecutionEvent?: (event: ExecutionEvent) => void,
  sourcePaths: string[] = [],
): VerificationContext {
  return { outputPath, sourcePaths, profile, onExecutionEvent };
}

describe("PDF verification", () => {
  test("all document checks pass with evidence and shared structural parse", async () => {
    const events: ExecutionEvent[] = [];
    const checks = await verifyChecks([
      { type: "file_valid", target: "pdf" },
      { type: "page_count_positive", target: 1 },
      { type: "text_extractable", target: 20 },
      { type: "format_matches", target: "pdf" },
    ], context(realPdf, (event) => events.push(event)));
    expect(checks.map((check) => check.name)).toEqual([
      "file_valid", "page_count_positive", "text_extractable", "format_matches",
    ]);
    expect(checks.every((check) => check.pass)).toBe(true);
    expect(checks[0]?.actual).toMatch(/^valid PDF 1\.\d \(1 page\)$/);
    expect(checks[1]?.actual).toBe("1 page");
    expect(checks[2]?.actual).toMatch(/\d+ non-whitespace chars; sample "Steward searchable document/);
    expect(checks[3]?.expected).toBe("output format PDF");
    const starts = events.filter((event) => event.type === "started");
    expect(starts.filter((event) => event.type === "started" && event.argv.includes("-dNODISPLAY"))).toHaveLength(1);
    expect(starts.filter((event) => event.type === "started" && event.argv.includes("-sDEVICE=txtwrite"))).toHaveLength(1);
    const pageArgv = starts.find((event) => event.type === "started" && event.argv.includes("-dNODISPLAY"));
    expect(pageArgv?.type === "started" ? pageArgv.argv : []).toContain(`-sPDFFile=${realpathSync(realPdf)}`);
  });

  test("page minimum fails with the real parsed count", async () => {
    const [check] = await verifyChecks(
      [{ type: "page_count_positive", target: 2 }], context(realPdf),
    );
    expect(check).toEqual({
      name: "page_count_positive", pass: false,
      expected: "at least 2 pages", actual: "1 page",
    });
  });

  test("text-less PDF fails extraction with zero-count evidence", async () => {
    const [check] = await verifyChecks(
      [{ type: "text_extractable", target: 1 }], context(textlessPdf),
    );
    expect(check?.pass).toBe(false);
    expect(check?.actual).toBe('0 non-whitespace chars; sample "(empty)"');
  });

  test("OCR proof requires text absent before and present after", async () => {
    const checks = await verifyChecks([
      { type: "text_extractable", target: textlessPdf },
      { type: "page_count_positive", target: textlessPdf },
    ], context(realPdf, undefined, [textlessPdf]));
    expect(checks).toEqual([
      {
        name: "text_extractable",
        pass: true,
        expected: "before=false on granted source; after=true on output",
        actual: expect.stringMatching(
          /^before=false \(0 non-whitespace chars\); after=true \(\d+ non-whitespace chars; sample "Steward searchable document/,
        ),
      },
      {
        name: "page_count_positive",
        pass: true,
        expected: "1 page on granted source",
        actual: "1 page on output",
      },
    ]);
  });

  test("OCR proof refuses a source path that was not explicitly granted", async () => {
    const checks = await verifyChecks([
      { type: "text_extractable", target: textlessPdf },
      { type: "page_count_positive", target: textlessPdf },
    ], context(realPdf));
    expect(checks.every((check) => check.pass)).toBe(false);
    expect(checks.map((check) => check.actual)).toEqual([
      `ungranted source: ${textlessPdf}`,
      `ungranted source: ${textlessPdf}`,
    ]);
  });

  test("renamed text and broken PDF structure fail file_valid", async () => {
    const [fake] = await verifyChecks([{ type: "file_valid", target: "pdf" }], context(fakePdf));
    expect(fake?.pass).toBe(false);
    expect(fake?.actual).toBe("expected PDF, found UTF-8 text");
    const [broken] = await verifyChecks([{ type: "file_valid", target: "pdf" }], context(brokenPdf));
    expect(broken?.pass).toBe(false);
    expect(broken?.actual).toBe("invalid PDF 1.7: 0 pages");
  });

  test("empty UTF-8 document fails with clear evidence", async () => {
    const [check] = await verifyChecks([{ type: "file_valid", target: "txt" }], context(empty));
    expect(check?.pass).toBe(false);
    expect(check?.actual).toBe("expected TXT, found empty file");
  });
});
