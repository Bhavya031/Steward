import type { MediaFormat } from "./media-formats.ts";
import type { PlanCheck, PlanTool } from "./plan.ts";

export const DOCUMENT_FORMATS = ["docx", "epub", "html", "md", "pdf", "txt"] as const;
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];
export type CompositionFamily = "media" | "document" | "subtitle";
export type MediaStream = "audio" | "video";
export type PdfTextLayer = "absent" | "present" | "unknown";

export type CompositionInputContract =
  | {
    family: "media";
    accepted_formats: MediaFormat[];
    required_streams: MediaStream[];
  }
  | {
    family: "document";
    accepted_formats: DocumentFormat[];
    required_pdf_text_layer?: Exclude<PdfTextLayer, "unknown">;
  }
  | { family: "subtitle"; accepted_formats: ["srt"] };

export type CompositionOutputContract =
  | { family: "media"; format: MediaFormat; streams: MediaStream[] }
  | { family: "document"; format: DocumentFormat; pdf_text_layer?: PdfTextLayer }
  | { family: "subtitle"; format: "srt" };

export interface CompositionContract {
  input: CompositionInputContract;
  output: CompositionOutputContract;
}

export interface ContractSource {
  tool: PlanTool;
  command_template: { commands: string[][]; output_path: string };
  checks: PlanCheck[];
}

export type CompatibilityResult =
  | { compatible: true }
  | {
    compatible: false;
    reason: "family" | "format" | "streams" | "pdf_text_layer";
  };

export function compositionCompatibility(
  output: CompositionOutputContract,
  input: CompositionInputContract,
): CompatibilityResult {
  if (output.family !== input.family) return { compatible: false, reason: "family" };
  if (!input.accepted_formats.includes(output.format as never)) {
    return { compatible: false, reason: "format" };
  }
  if (output.family === "media" && input.family === "media") {
    const present = new Set(output.streams);
    if (!input.required_streams.every((stream) => present.has(stream))) {
      return { compatible: false, reason: "streams" };
    }
  }
  if (output.family === "document" && input.family === "document" && output.format === "pdf" &&
      input.required_pdf_text_layer !== undefined &&
      output.pdf_text_layer !== input.required_pdf_text_layer) {
    return { compatible: false, reason: "pdf_text_layer" };
  }
  return { compatible: true };
}

export function sameCompositionContract(
  left: CompositionContract,
  right: CompositionContract,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export { deriveCompositionContract } from "./composition-contract-derivation.ts";
