import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executePlan } from "../executor.ts";
import type { Plan } from "../plan.ts";
import { probeSystem } from "../probe.ts";
import { verifyChecks, type VerificationContext } from "./index.ts";

const root = mkdtempSync(join(tmpdir(), "steward-format-verify-"));
const profile = probeSystem();
const markdown = join(root, "source.md");
const docx = join(root, "source.docx");
const epub = join(root, "source.epub");
const invalidUtf8 = join(root, "invalid.txt");
const brokenZip = join(root, "broken.docx");

function pandocPlan(output: string): Plan {
  return {
    tool: "pandoc", install_cmd: null,
    commands: [["pandoc", markdown, "-o", output]],
    output_path: output,
    checks: [{ type: "file_valid", target: output.endsWith(".docx") ? "docx" : "epub" }],
  };
}

beforeAll(async () => {
  writeFileSync(markdown, "# Steward\n\nPortable document text for structural verification.\n");
  writeFileSync(invalidUtf8, Buffer.from([0xff, 0xfe, 0xfd]));
  writeFileSync(brokenZip, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]));
  for (const plan of [pandocPlan(docx), pandocPlan(epub)]) {
    const execution = await executePlan(plan, profile, [markdown]);
    if (!execution.ok) throw new Error(`pandoc fixture failed: ${execution.stderr_tail}`);
  }
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

function context(outputPath: string): VerificationContext {
  return { outputPath, sourcePaths: [markdown], profile };
}

describe("document format validation", () => {
  test("validates DOCX and EPUB ZIP structures by internal markers", async () => {
    const [docxCheck] = await verifyChecks([{ type: "file_valid", target: "docx" }], context(docx));
    expect(docxCheck?.pass).toBe(true);
    expect(docxCheck?.actual).toBe(
      "valid DOCX ZIP (found [Content_Types].xml, word/document.xml)",
    );
    const [epubCheck] = await verifyChecks([{ type: "file_valid", target: "epub" }], context(epub));
    expect(epubCheck?.pass).toBe(true);
    expect(epubCheck?.actual).toBe(
      "valid EPUB ZIP (found mimetype, META-INF/container.xml)",
    );
  });

  test("format_matches reuses structure and names the promised format", async () => {
    const [check] = await verifyChecks([{ type: "format_matches", target: "docx" }], context(docx));
    expect(check?.pass).toBe(true);
    expect(check?.expected).toBe("output format DOCX");
    expect(check?.actual).toContain("valid DOCX ZIP");
  });

  test("reports the detected ZIP kind on a PDF mismatch", async () => {
    const [check] = await verifyChecks([{ type: "file_valid", target: "pdf" }], context(docx));
    expect(check?.pass).toBe(false);
    expect(check?.actual).toBe("expected PDF, found DOCX ZIP");
  });

  test("accepts non-empty UTF-8 text formats without trusting extensions", async () => {
    for (const format of ["txt", "md", "html"] as const) {
      const [check] = await verifyChecks([{ type: "file_valid", target: format }], context(markdown));
      expect(check?.pass).toBe(true);
      expect(check?.actual).toContain(`valid UTF-8 ${format.toUpperCase()}`);
    }
  });

  test("rejects invalid UTF-8 and malformed ZIP structures", async () => {
    const [text] = await verifyChecks([{ type: "file_valid", target: "txt" }], context(invalidUtf8));
    expect(text?.pass).toBe(false);
    expect(text?.actual).toBe("expected TXT, found invalid UTF-8");
    const [zip] = await verifyChecks([{ type: "file_valid", target: "docx" }], context(brokenZip));
    expect(zip?.pass).toBe(false);
    expect(zip?.actual).toContain("expected DOCX, found invalid ZIP");
  });
});
