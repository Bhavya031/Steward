import {
  checkedValue, classifySimple, matches, oneOf, pathValue,
  type ClassifiedPath, type ToolFlagRules,
} from "./flag-policy-core.ts";

const integer = matches(/^\d+$/);
const pandoc: ToolFlagRules = {
  switches: new Set(["-s", "--standalone", "--toc", "--no-highlight", "--strip-comments"]),
  values: new Map([
    ["-o", pathValue("output")], ["--output", pathValue("output", true)],
    ["-f", checkedValue(oneOf("markdown", "gfm", "commonmark", "html", "docx", "epub", "rst"))],
    ["--from", checkedValue(oneOf("markdown", "gfm", "commonmark", "html", "docx", "epub", "rst"), true)],
    ["-t", checkedValue(oneOf("html", "html5", "docx", "epub", "gfm", "commonmark", "plain", "rst"))],
    ["--to", checkedValue(oneOf("html", "html5", "docx", "epub", "gfm", "commonmark", "plain", "rst"), true)],
    ["--wrap", checkedValue(oneOf("auto", "none", "preserve"), true)],
    ["--columns", checkedValue(integer, true)], ["--shift-heading-level-by", checkedValue(matches(/^-?\d+$/), true)],
  ]),
  positionals: "input", minPositionals: 1,
};

const gs: ToolFlagRules = {
  switches: new Set(["-q", "-dBATCH", "-dNOPAUSE", "-dSAFER", "-dQUIET"]),
  values: new Map([
    ["-sOutputFile", pathValue("output", true)],
    ["-sDEVICE", checkedValue(oneOf("pdfwrite"), true)],
    ["-dCompatibilityLevel", checkedValue(matches(/^1\.[4-7]$/), true)],
    ["-dPDFSETTINGS", checkedValue(oneOf("/screen", "/ebook", "/printer", "/prepress", "/default"), true)],
    ["-dColorImageResolution", checkedValue(integer, true)],
    ["-dGrayImageResolution", checkedValue(integer, true)],
    ["-dMonoImageResolution", checkedValue(integer, true)],
    ["-dDownsampleColorImages", checkedValue(oneOf("true", "false"), true)],
    ["-dDownsampleGrayImages", checkedValue(oneOf("true", "false"), true)],
    ["-dDownsampleMonoImages", checkedValue(oneOf("true", "false"), true)],
  ]),
  positionals: "input", minPositionals: 1,
};

const soffice: ToolFlagRules = {
  switches: new Set(["--headless", "--nologo", "--nolockcheck", "--nodefault", "--nofirststartwizard"]),
  values: new Map([
    ["--convert-to", checkedValue(oneOf(
      "pdf", "pdf:writer_pdf_Export", "docx", "xlsx", "pptx", "odt", "ods", "odp", "html", "txt",
    ), true)],
    ["--outdir", pathValue("output-directory", true)],
  ]),
  positionals: ["input"], minPositionals: 1, maxPositionals: 1,
};

const ocr: ToolFlagRules = {
  switches: new Set(["--skip-text", "--force-ocr", "--deskew", "--clean", "--clean-final", "--rotate-pages", "--remove-background"]),
  values: new Map([
    ["--optimize", checkedValue(matches(/^[0-3]$/), true)],
    ["--output-type", checkedValue(oneOf("pdf", "pdfa", "pdfa-1", "pdfa-2", "pdfa-3"), true)],
    ["--language", checkedValue(matches(/^[a-z]{3}(?:\+[a-z]{3})*$/), true)],
    ["--jobs", checkedValue(integer, true)], ["--pages", checkedValue(matches(/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/), true)],
  ]),
  positionals: ["input", "output"], minPositionals: 2, maxPositionals: 2,
};

export function classifyDocumentTool(tool: "pandoc" | "gs" | "soffice" | "ocrmypdf", command: string[]): ClassifiedPath[] {
  const paths = classifySimple(command, tool === "pandoc" ? pandoc : tool === "gs" ? gs : tool === "soffice" ? soffice : ocr);
  if (tool === "gs") {
    const required = ["-dSAFER", "-dBATCH", "-dNOPAUSE", "-sDEVICE=pdfwrite"];
    if (required.some((flag) => !command.includes(flag)) || !paths.some((path) => path.role === "output")) {
      throw new Error("Ghostscript plans require SAFER batch pdfwrite with one validated output");
    }
  }
  if (tool === "soffice" && (!command.includes("--headless") ||
      !command.some((arg) => arg === "--convert-to" || arg.startsWith("--convert-to=")))) {
    throw new Error("LibreOffice plans require headless conversion mode");
  }
  return paths;
}
