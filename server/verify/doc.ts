import type { CheckTarget } from "../plan.ts";
import { result } from "./common.ts";
import { documentFormat, hasPdfHeader, validateDocumentFormat } from "./file-format.ts";
import { verifyOcrTextAdded, verifyPdfPageCountPreserved } from "./pdf-ocr.ts";
import { extractPdfText, measurePdfPages, type PdfTextEvidence } from "./pdf.ts";
import { inspectUtf8 } from "./text-inspector.ts";
import type { VerificationResult, VerificationRunContext } from "./types.ts";

export const DOC_CHECK_TYPES = [
  "file_valid", "page_count_positive", "text_extractable", "format_matches",
] as const;
export type DocCheckType = (typeof DOC_CHECK_TYPES)[number];

async function fileValid(
  name: "file_valid" | "format_matches",
  target: CheckTarget,
  context: VerificationRunContext,
): Promise<VerificationResult> {
  const format = documentFormat(target);
  if (!format) {
    return result(name, false, "supported document format", `invalid expected format: ${String(target)}`);
  }
  const evidence = await validateDocumentFormat(context.outputPath, format, context);
  const expected = name === "format_matches" ? `output format ${format.toUpperCase()}` : evidence.expected;
  return result(name, evidence.pass, expected, evidence.actual);
}

async function pageCountPositive(
  target: CheckTarget,
  context: VerificationRunContext,
): Promise<VerificationResult> {
  if (typeof target === "string") return verifyPdfPageCountPreserved(target, context);
  if (typeof target !== "number" || !Number.isInteger(target) || target < 1) {
    return result("page_count_positive", false, "positive integer page minimum", `invalid target: ${String(target)}`);
  }
  const expected = `at least ${target} ${target === 1 ? "page" : "pages"}`;
  if (!hasPdfHeader(context.outputPath)) {
    const format = await validateDocumentFormat(context.outputPath, "pdf", context);
    return result("page_count_positive", false, expected, format.actual);
  }
  try {
    const pages = await measurePdfPages(context.outputPath, context);
    return result(
      "page_count_positive", pages >= target,
      expected, `${pages} ${pages === 1 ? "page" : "pages"}`,
    );
  } catch (error) {
    return result("page_count_positive", false, expected, `PDF parse failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function textResult(
  target: number,
  evidence: PdfTextEvidence,
): VerificationResult {
  const sample = evidence.sample || "(empty)";
  return result(
    "text_extractable", evidence.nonWhitespaceChars >= target,
    `at least ${target} non-whitespace characters`,
    `${evidence.nonWhitespaceChars} non-whitespace chars; sample ${JSON.stringify(sample)}`,
  );
}

async function textExtractable(
  target: CheckTarget,
  context: VerificationRunContext,
): Promise<VerificationResult> {
  if (typeof target === "string") return verifyOcrTextAdded(target, context);
  if (typeof target !== "number" || !Number.isInteger(target) || target < 1) {
    return result("text_extractable", false, "positive integer character minimum", `invalid target: ${String(target)}`);
  }
  if (hasPdfHeader(context.outputPath)) {
    try {
      return textResult(target, await extractPdfText(context.outputPath, context));
    } catch (error) {
      return result("text_extractable", false, `at least ${target} non-whitespace characters`, `text extraction failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const text = inspectUtf8(context.outputPath);
  if (!text.valid) {
    return result("text_extractable", false, `at least ${target} non-whitespace characters`, `not extractable text: ${text.error}`);
  }
  return textResult(target, text);
}

export async function verifyDocCheck(
  type: DocCheckType,
  target: CheckTarget,
  context: VerificationRunContext,
): Promise<VerificationResult> {
  if (type === "file_valid") return fileValid(type, target, context);
  if (type === "format_matches") return fileValid(type, target, context);
  if (type === "page_count_positive") return pageCountPositive(target, context);
  return textExtractable(target, context);
}
