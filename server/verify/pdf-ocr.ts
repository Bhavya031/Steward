import type { CheckTarget } from "../plan.ts";
import { grantedSource, result } from "./common.ts";
import { extractPdfText, measurePdfPages, type PdfTextEvidence } from "./pdf.ts";
import type { VerificationResult, VerificationRunContext } from "./types.ts";

function pageLabel(count: number): string {
  return `${count} ${count === 1 ? "page" : "pages"}`;
}

function textState(evidence: PdfTextEvidence): string {
  return evidence.nonWhitespaceChars > 0 ? "true" : "false";
}

export async function verifyPdfPageCountMatches(
  target: CheckTarget,
  context: VerificationRunContext,
): Promise<VerificationResult> {
  const expected = "same page count as granted source";
  if (typeof target !== "string") {
    return result("page_count_matches", false, expected, `invalid target: ${String(target)}`);
  }
  const source = grantedSource(target, context);
  if (!source) {
    return result("page_count_matches", false, expected, `ungranted source: ${target}`);
  }
  try {
    const [before, after] = await Promise.all([
      measurePdfPages(source, context),
      measurePdfPages(context.outputPath, context),
    ]);
    return result(
      "page_count_matches", before === after,
      `${pageLabel(before)} on granted source`,
      `${pageLabel(after)} on output`,
    );
  } catch (error) {
    return result(
      "page_count_matches", false, expected,
      `PDF page comparison failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function verifyOcrTextAdded(
  target: CheckTarget,
  context: VerificationRunContext,
): Promise<VerificationResult> {
  const expected = "before=false on granted source; after=true on output";
  if (typeof target !== "string") {
    return result("text_extractable", false, expected, `invalid target: ${String(target)}`);
  }
  const source = grantedSource(target, context);
  if (!source) {
    return result("text_extractable", false, expected, `ungranted source: ${target}`);
  }
  try {
    const [before, after] = await Promise.all([
      extractPdfText(source, context),
      extractPdfText(context.outputPath, context),
    ]);
    const sample = after.sample || "(empty)";
    const actual = [
      `before=${textState(before)} (${before.nonWhitespaceChars} non-whitespace chars)`,
      `after=${textState(after)} (${after.nonWhitespaceChars} non-whitespace chars; sample ${JSON.stringify(sample)})`,
    ].join("; ");
    return result(
      "text_extractable",
      before.nonWhitespaceChars === 0 && after.nonWhitespaceChars > 0,
      expected,
      actual,
    );
  } catch (error) {
    return result(
      "text_extractable", false, expected,
      `OCR text comparison failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
