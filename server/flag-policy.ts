import { ExecutionError } from "./execution-types.ts";
import { classifyDocumentTool } from "./flag-policy-doc.ts";
import { classifyFfmpeg } from "./flag-policy-ffmpeg.ts";
import { classifyMediaTool } from "./flag-policy-media.ts";
import type { ClassifiedPath } from "./flag-policy-core.ts";
import type { PlanTool } from "./plan.ts";

const PANDOC_EXECUTION_FLAGS = ["--lua-filter", "--filter", "--pdf-engine", "--template"];

function explicitDenials(tool: PlanTool, command: string[]): void {
  if (tool === "gs" && command.some((token) =>
    /^-d(?:no|delay)safer(?:=|$)/i.test(token) || /%(?:pipe|handle)%/i.test(token)
  )) throw new ExecutionError("Ghostscript unsafe mode and pipe/handle targets are forbidden");
  if (tool === "ffmpeg" && command.some((token) => /(?:^|[,;])a?movie\s*=/i.test(token))) {
    throw new ExecutionError("ffmpeg movie/amovie filter sources are forbidden");
  }
  if (tool === "pandoc" && command.some((token) =>
    PANDOC_EXECUTION_FLAGS.some((flag) => token === flag || token.startsWith(`${flag}=`))
  )) throw new ExecutionError("pandoc executable filters, engines, and templates are forbidden");
}

export function classifyCommand(tool: PlanTool, command: string[]): ClassifiedPath[] {
  explicitDenials(tool, command);
  if (tool === "ffmpeg") return classifyFfmpeg(command);
  if (tool === "pandoc" || tool === "gs" || tool === "soffice" || tool === "ocrmypdf") {
    return classifyDocumentTool(tool, command);
  }
  return classifyMediaTool(tool, command);
}
