import { DOCUMENT_FORMATS, type CompositionContract, type CompositionInputContract,
  type CompositionOutputContract, type DocumentFormat, type MediaStream,
} from "./composition-contract.ts";
import { MEDIA_FORMATS, type MediaFormat } from "./media-formats.ts";

const MEDIA_FORMAT_SET = new Set<string>(MEDIA_FORMATS);
const DOCUMENT_FORMAT_SET = new Set<string>(DOCUMENT_FORMATS);
const STREAM_SET = new Set<string>(["audio", "video"]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function uniqueArray<T extends string>(value: unknown, allowed: Set<string>, label: string): T[] {
  if (!Array.isArray(value) || value.length === 0 ||
      !value.every((item) => typeof item === "string" && allowed.has(item)) ||
      new Set(value).size !== value.length) {
    throw new Error(`${label} must be a non-empty unique allowlisted array`);
  }
  return [...value] as T[];
}

function validateInput(value: unknown): CompositionInputContract {
  if (!record(value) || typeof value.family !== "string") {
    throw new Error("composition input contract is malformed");
  }
  if (value.family === "media" && exactKeys(value, ["family", "accepted_formats", "required_streams"])) {
    return {
      family: "media",
      accepted_formats: uniqueArray<MediaFormat>(value.accepted_formats, MEDIA_FORMAT_SET, "accepted media formats"),
      required_streams: uniqueArray<MediaStream>(value.required_streams, STREAM_SET, "required media streams"),
    };
  }
  if (value.family === "document" &&
      (exactKeys(value, ["family", "accepted_formats"]) ||
       exactKeys(value, ["family", "accepted_formats", "required_pdf_text_layer"]))) {
    const formats = uniqueArray<DocumentFormat>(
      value.accepted_formats, DOCUMENT_FORMAT_SET, "accepted document formats",
    );
    const requirement = value.required_pdf_text_layer;
    if (requirement !== undefined &&
        (requirement !== "absent" && requirement !== "present" ||
         formats.length !== 1 || formats[0] !== "pdf")) {
      throw new Error("PDF text-layer requirements may only constrain PDF input");
    }
    return {
      family: "document", accepted_formats: formats,
      ...(requirement === undefined ? {} : { required_pdf_text_layer: requirement }),
    };
  }
  if (value.family === "subtitle" && exactKeys(value, ["family", "accepted_formats"]) &&
      Array.isArray(value.accepted_formats) && value.accepted_formats.length === 1 &&
      value.accepted_formats[0] === "srt") {
    return { family: "subtitle", accepted_formats: ["srt"] };
  }
  throw new Error("composition input contract is invalid");
}

function validateOutput(value: unknown): CompositionOutputContract {
  if (!record(value) || typeof value.family !== "string") {
    throw new Error("composition output contract is malformed");
  }
  if (value.family === "media" && exactKeys(value, ["family", "format", "streams"]) &&
      typeof value.format === "string" && MEDIA_FORMAT_SET.has(value.format)) {
    return {
      family: "media", format: value.format as MediaFormat,
      streams: uniqueArray<MediaStream>(value.streams, STREAM_SET, "present media streams"),
    };
  }
  if (value.family === "document" && typeof value.format === "string" &&
      DOCUMENT_FORMAT_SET.has(value.format)) {
    if (value.format === "pdf" && exactKeys(value, ["family", "format", "pdf_text_layer"]) &&
        ["absent", "present", "unknown"].includes(value.pdf_text_layer as string)) {
      return { family: "document", format: "pdf", pdf_text_layer: value.pdf_text_layer as "absent" | "present" | "unknown" };
    }
    if (value.format !== "pdf" && exactKeys(value, ["family", "format"])) {
      return { family: "document", format: value.format as DocumentFormat };
    }
  }
  if (value.family === "subtitle" && exactKeys(value, ["family", "format"]) && value.format === "srt") {
    return { family: "subtitle", format: "srt" };
  }
  throw new Error("composition output contract is invalid");
}

export function validateCompositionContract(value: unknown): CompositionContract {
  if (!record(value) || !exactKeys(value, ["input", "output"])) {
    throw new Error("composition contract is malformed");
  }
  return { input: validateInput(value.input), output: validateOutput(value.output) };
}
