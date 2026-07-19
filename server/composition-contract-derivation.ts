import { extname } from "node:path";
import { MEDIA_FORMATS, mediaFormat, type MediaFormat } from "./media-formats.ts";
import type { PlanCheck } from "./plan.ts";
import type {
  CompositionContract, CompositionInputContract, CompositionOutputContract,
  ContractSource, DocumentFormat, MediaStream,
} from "./composition-contract.ts";
const DOCUMENT_FORMATS: DocumentFormat[] = ["docx", "epub", "html", "md", "pdf", "txt"];
const DOCUMENT_SET = new Set<string>(DOCUMENT_FORMATS);
const STREAM_ORDER: MediaStream[] = ["video", "audio"];
const INPUT_SLOT = /\{\{input_(\d+)(?:_(?:dir|name|stem|ext))?\}\}/g;
function documentFormat(value: unknown): DocumentFormat | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/^\./, "");
  const alias = normalized === "markdown" ? "md" : normalized === "text" ? "txt" : normalized;
  return DOCUMENT_SET.has(alias) ? alias as DocumentFormat : null;
}
function uniqueStreams(streams: Iterable<MediaStream>): MediaStream[] {
  const found = new Set(streams);
  return STREAM_ORDER.filter((stream) => found.has(stream));
}
function inputIndices(commands: string[][]): Set<number> {
  const indices = new Set<number>();
  for (const argument of commands.flat()) {
    for (const match of argument.matchAll(INPUT_SLOT)) indices.add(Number(match[1]));
  }
  return indices;
}
function consumesFirstInput(command: string[]): boolean {
  return command.some((argument) => argument.includes("{{input_0}}"));
}

function promisedFormat(source: ContractSource): MediaFormat | DocumentFormat | "srt" | null {
  const formats: Array<MediaFormat | DocumentFormat | "srt"> = source.checks.flatMap((check) => {
    if (check.type !== "format_matches" && check.type !== "file_valid") return [];
    const format = mediaFormat(check.target) ?? documentFormat(check.target);
    return format ? [format] : [];
  });
  if (source.checks.some((check) =>
    check.type === "srt_valid" || check.type === "cue_count" || check.type === "timestamps_monotonic"
  )) formats.push("srt");
  const extension = extname(source.command_template.output_path).slice(1).toLowerCase();
  const extensionFormat = mediaFormat(extension) ?? documentFormat(extension) ??
    (extension === "srt" ? "srt" : null);
  if (extensionFormat) formats.push(extensionFormat);
  const distinct = [...new Set(formats)];
  return distinct.length === 1 ? distinct[0]! : null;
}
function outputStreams(checks: PlanCheck[]): MediaStream[] {
  const streams: MediaStream[] = [];
  for (const check of checks) {
    if (check.type === "streams_present" && typeof check.target === "string") {
      for (const stream of check.target.split(",")) {
        if (stream === "audio" || stream === "video") streams.push(stream);
      }
    }
    if (check.type === "audio_stream_present" && check.target === true) streams.push("audio");
  }
  return uniqueStreams(streams);
}
function mediaInputStreams(source: ContractSource, output: CompositionOutputContract): MediaStream[] {
  const streams: MediaStream[] = [];
  for (const command of source.command_template.commands.filter(consumesFirstInput)) {
    for (let index = 0; index < command.length; index += 1) {
      const argument = command[index];
      if (["-af", "-filter:a", "-vn", "-ac", "-ar"].includes(argument!)) streams.push("audio");
      if (["-vf", "-filter:v", "-an"].includes(argument!)) streams.push("video");
      if (argument === "-map") {
        const mapping = command[index + 1] ?? "";
        if (/\bv(?::|$)/.test(mapping)) streams.push("video");
        if (/\ba(?::|$)/.test(mapping)) streams.push("audio");
      }
    }
  }
  if (output.family === "media") streams.push(...output.streams);
  if (output.family === "subtitle") streams.push("audio");
  return uniqueStreams(streams);
}
function deriveOutput(source: ContractSource): CompositionOutputContract | null {
  const format = promisedFormat(source);
  if (!format) return null;
  if (format === "srt") {
    const valid = source.checks.some((check) => check.type === "srt_valid" && check.target === true) &&
      source.checks.some((check) => check.type === "timestamps_monotonic" && check.target === true);
    return valid ? { family: "subtitle", format: "srt" } : null;
  }
  const media = mediaFormat(format);
  if (media) {
    const streams = outputStreams(source.checks);
    return streams.length > 0 ? { family: "media", format: media, streams } : null;
  }
  const document = documentFormat(format);
  if (!document) return null;
  if (document !== "pdf") return { family: "document", format: document };
  const textLayer = source.checks.some((check) => check.type === "text_extractable")
    ? "present" as const : "unknown" as const;
  return { family: "document", format: "pdf", pdf_text_layer: textLayer };
}
function pandocInputFormats(commands: string[][]): DocumentFormat[] | null {
  const declared: DocumentFormat[] = [];
  const aliases: Record<string, DocumentFormat | undefined> = {
    markdown: "md", gfm: "md", commonmark: "md",
    html: "html", docx: "docx", epub: "epub",
  };
  for (const command of commands) {
    for (let index = 1; index < command.length; index += 1) {
      const token = command[index]!;
      let value: string | undefined;
      if (token === "-f" || token === "--from") value = command[++index];
      else if (token.startsWith("--from=")) value = token.slice("--from=".length);
      if (value === undefined) continue;
      const format = aliases[value];
      if (!format) return null;
      declared.push(format);
    }
  }
  const distinct = [...new Set(declared)];
  return distinct.length === 1 ? distinct : null;
}
function deriveInput(source: ContractSource, output: CompositionOutputContract): CompositionInputContract | null {
  const consumers = source.command_template.commands.filter(consumesFirstInput);
  const tools = new Set(consumers.map((command) => command[0]));
  if (tools.size !== 1) return null;
  const tool = [...tools][0];
  if (tool === "ffmpeg") {
    const required = mediaInputStreams(source, output);
    return required.length > 0
      ? { family: "media", accepted_formats: [...MEDIA_FORMATS], required_streams: required }
      : null;
  }
  if (tool === "pandoc") {
    const accepted = pandocInputFormats(consumers);
    return accepted ? { family: "document", accepted_formats: accepted } : null;
  }
  if (tool === "ocrmypdf") {
    return { family: "document", accepted_formats: ["pdf"], required_pdf_text_layer: "absent" };
  }
  return null;
}

export function deriveCompositionContract(source: ContractSource): CompositionContract | null {
  const indices = inputIndices(source.command_template.commands);
  if (indices.size !== 1 || !indices.has(0)) return null;
  const output = deriveOutput(source);
  if (!output) return null;
  const input = deriveInput(source, output);
  return input ? { input, output } : null;
}
