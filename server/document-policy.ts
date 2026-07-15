import { validateMediaPath } from "./ffprobe-policy.ts";

export type GhostscriptDocumentQuery = "page_count" | "text";

export function buildGhostscriptDocumentCommand(
  query: GhostscriptDocumentQuery,
  inputPath: unknown,
): string[] {
  const path = validateMediaPath(inputPath);
  const common = ["gs", "-q", "-dBATCH", "-dNOPAUSE", "-dSAFER", `--permit-file-read=${path}`];
  if (query === "page_count") {
    return [
      ...common, "-dNODISPLAY", `-sPDFFile=${path}`,
      "-c", "PDFFile (r) file runpdfbegin pdfpagecount = quit",
    ];
  }
  return [...common, "-sDEVICE=txtwrite", "-sOutputFile=-", path];
}
