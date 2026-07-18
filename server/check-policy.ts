import { mediaFormat } from "./media-formats.ts";
import type { PlanCheck } from "./plan.ts";

const DOCUMENT_FORMATS = new Set(["pdf", "docx", "epub", "html", "md", "txt"]);

function documentFormat(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/^\./, "");
  const alias = normalized === "markdown" ? "md" : normalized === "text" ? "txt" : normalized;
  return DOCUMENT_FORMATS.has(alias) ? alias : null;
}

function positiveInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function finiteNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

export function checkSemanticError(checks: PlanCheck[]): string | null {
  const errors: string[] = [];
  for (const [index, check] of checks.entries()) {
    const at = `checks[${index}] ${check.type}`;
    if (check.type === "size_under" && !positiveInteger(check.target)) {
      errors.push(`${at} target must be a positive integer byte count`);
    } else if (check.type === "duration_matches" && typeof check.target !== "string") {
      errors.push(`${at} target must be a source path`);
    } else if (check.type === "streams_present" &&
        (typeof check.target !== "string" || !/^(?:video|audio)(?:,(?:video|audio))*$/.test(check.target))) {
      errors.push(`${at} target must list video/audio streams`);
    } else if ((check.type === "plays" || check.type === "audio_stream_present") &&
        typeof check.target !== "boolean") {
      errors.push(`${at} target must be boolean`);
    } else if ((check.type === "loudness_matches" || check.type === "true_peak_under") &&
        !finiteNumber(check.target)) {
      errors.push(`${at} target must be a finite number`);
    } else if (check.type === "file_valid" && !documentFormat(check.target)) {
      errors.push(`${at} target must be pdf/docx/epub/html/md/txt`);
    } else if ((check.type === "page_count_positive" || check.type === "text_extractable") &&
        !positiveInteger(check.target)) {
      errors.push(`${at} target must be a positive integer`);
    } else if (check.type === "format_matches" &&
        !documentFormat(check.target) && !mediaFormat(check.target)) {
      errors.push(`${at} target is not a supported document or media format`);
    } else if ((check.type === "srt_valid" || check.type === "timestamps_monotonic") &&
        check.target !== true) {
      errors.push(`${at} target must be true`);
    } else if (check.type === "cue_count" && !positiveInteger(check.target)) {
      errors.push(`${at} target must be a positive integer minimum`);
    }
  }

  const promised = checks.find((check) => check.type === "format_matches");
  const outputFormat = documentFormat(promised?.target);
  if (outputFormat && outputFormat !== "pdf" && checks.some((check) => check.type === "page_count_positive")) {
    errors.push(`page_count_positive is only supported for PDF output, not ${outputFormat.toUpperCase()}`);
  }
  if ((outputFormat === "docx" || outputFormat === "epub") &&
      checks.some((check) => check.type === "text_extractable")) {
    errors.push(`text_extractable is not supported for ${outputFormat.toUpperCase()} output`);
  }
  const fileFormat = documentFormat(checks.find((check) => check.type === "file_valid")?.target);
  if (fileFormat && outputFormat && fileFormat !== outputFormat) {
    errors.push(`file_valid target ${fileFormat} must match format_matches target ${outputFormat}`);
  }
  return errors.length > 0 ? errors.join("; ") : null;
}
