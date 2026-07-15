import { openSync, closeSync, readSync, statSync } from "node:fs";
import { validateMediaPath } from "../ffprobe-policy.ts";
import { measurePdfPages } from "./pdf.ts";
import { inspectUtf8 } from "./text-inspector.ts";
import type { VerificationRunContext } from "./types.ts";
import { inspectZip, type ZipInspection } from "./zip-inspector.ts";

export type DocumentFormat = "pdf" | "docx" | "epub" | "html" | "md" | "txt";
export interface FormatEvidence { pass: boolean; expected: string; actual: string }
const FORMATS = new Set<DocumentFormat>(["pdf", "docx", "epub", "html", "md", "txt"]);

export function documentFormat(value: unknown): DocumentFormat | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/^\./, "");
  const alias = normalized === "markdown" ? "md" : normalized === "text" ? "txt" : normalized;
  return FORMATS.has(alias as DocumentFormat) ? alias as DocumentFormat : null;
}

function prefix(path: string, length = 16): Buffer {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(Math.min(length, statSync(path).size));
    readSync(fd, buffer, 0, buffer.length, 0);
    return buffer;
  } finally {
    closeSync(fd);
  }
}

function pdfVersion(bytes: Buffer): string | null {
  return bytes.toString("ascii", 0, 8).match(/^%PDF-(\d\.\d)/)?.[1] ?? null;
}

function zipKind(zip: ZipInspection): string {
  if (!zip.valid) return `invalid ZIP (${zip.error ?? "unknown structure"})`;
  if (zip.names.has("[Content_Types].xml") && zip.names.has("word/document.xml")) return "DOCX ZIP";
  if (zip.names.has("mimetype") && zip.names.has("META-INF/container.xml")) return "EPUB ZIP";
  return "ZIP";
}

function describeFound(path: string, bytes: Buffer): string {
  if (bytes.length === 0) return "empty file";
  const version = pdfVersion(bytes);
  if (version) return `PDF ${version} header`;
  if (bytes.length >= 2 && bytes.readUInt16LE(0) === 0x4b50) return zipKind(inspectZip(path));
  const text = inspectUtf8(path);
  if (text.valid) return "UTF-8 text";
  return `binary data (${bytes.subarray(0, 4).toString("hex").toUpperCase()})`;
}

function zipEvidence(expected: "docx" | "epub", path: string, bytes: Buffer): FormatEvidence {
  const label = expected.toUpperCase();
  if (bytes.length < 2 || bytes.readUInt16LE(0) !== 0x4b50) {
    return { pass: false, expected: `valid ${label} ZIP`, actual: `expected ${label}, found ${describeFound(path, bytes)}` };
  }
  const zip = inspectZip(path);
  const required = expected === "docx"
    ? ["[Content_Types].xml", "word/document.xml"]
    : ["mimetype", "META-INF/container.xml"];
  const pass = zip.valid && required.every((name) => zip.names.has(name));
  const actual = pass
    ? `valid ${label} ZIP (found ${required.join(", ")})`
    : `expected ${label}, found ${zipKind(zip)}`;
  return { pass, expected: `valid ${label} ZIP`, actual };
}

export async function validateDocumentFormat(
  file: string,
  expected: DocumentFormat,
  context: VerificationRunContext,
): Promise<FormatEvidence> {
  const path = validateMediaPath(file);
  const bytes = prefix(path);
  if (expected === "pdf") {
    const version = pdfVersion(bytes);
    if (!version) return { pass: false, expected: "valid PDF", actual: `expected PDF, found ${describeFound(path, bytes)}` };
    try {
      const pages = await measurePdfPages(path, context);
      return { pass: pages > 0, expected: "valid PDF", actual: pages > 0
        ? `valid PDF ${version} (${pages} ${pages === 1 ? "page" : "pages"})`
        : `invalid PDF ${version}: 0 pages` };
    } catch (error) {
      return { pass: false, expected: "valid PDF", actual: `invalid PDF ${version}: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  if (expected === "docx" || expected === "epub") return zipEvidence(expected, path, bytes);
  const text = inspectUtf8(path);
  const label = expected.toUpperCase();
  return {
    pass: text.valid,
    expected: `non-empty UTF-8 ${label}`,
    actual: text.valid
      ? `valid UTF-8 ${label} (${text.bytes} bytes)`
      : `expected ${label}, found ${text.error ?? describeFound(path, bytes)}`,
  };
}

export function hasPdfHeader(file: string): boolean {
  return pdfVersion(prefix(validateMediaPath(file))) !== null;
}
