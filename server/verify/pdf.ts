import { realpathSync } from "node:fs";
import { executeGhostscriptDocument } from "../executor.ts";
import type { ExecutionEvent } from "../execution-types.ts";
import type { VerificationRunContext } from "./types.ts";

export interface PdfTextEvidence {
  nonWhitespaceChars: number;
  sample: string;
}

export function parseGhostscriptPageCount(stdout: string): number {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!/^\d+$/.test(lines[index]!)) continue;
    const pages = Number(lines[index]);
    if (Number.isSafeInteger(pages) && pages >= 0) return pages;
  }
  throw new Error("Ghostscript returned no page count");
}

function options(context: VerificationRunContext, observe?: (event: ExecutionEvent) => void) {
  return {
    ...context.executionOptions,
    onEvent: (event: ExecutionEvent) => {
      observe?.(event);
      context.onExecutionEvent?.(event);
    },
  };
}

export async function measurePdfPages(
  file: string,
  context: VerificationRunContext,
): Promise<number> {
  const key = `pdf-pages:${realpathSync(file)}`;
  const cached = context.measurements.get(key) as Promise<number> | undefined;
  if (cached) return cached;
  const measurement = (async () => {
    const execution = await executeGhostscriptDocument("page_count", file, context.profile, options(context));
    if (!execution.ok) {
      throw new Error(`Ghostscript PDF parse exited ${execution.exit_code}: ${execution.stderr_tail.trim()}`);
    }
    return parseGhostscriptPageCount(execution.stdout_tail);
  })();
  context.measurements.set(key, measurement);
  return measurement;
}

export async function extractPdfText(
  file: string,
  context: VerificationRunContext,
): Promise<PdfTextEvidence> {
  const key = `pdf-text:${realpathSync(file)}`;
  const cached = context.measurements.get(key) as Promise<PdfTextEvidence> | undefined;
  if (cached) return cached;
  const measurement = (async () => {
    let nonWhitespaceChars = 0;
    let sampleSource = "";
    const observe = (event: ExecutionEvent): void => {
      if (event.type !== "stdout") return;
      for (const character of event.chunk) if (/\S/u.test(character)) nonWhitespaceChars += 1;
      if (sampleSource.length < 1_024) sampleSource += event.chunk.slice(0, 1_024 - sampleSource.length);
    };
    const execution = await executeGhostscriptDocument("text", file, context.profile, options(context, observe));
    if (!execution.ok) {
      throw new Error(`Ghostscript text extraction exited ${execution.exit_code}: ${execution.stderr_tail.trim()}`);
    }
    const sample = sampleSource.replace(/\s+/g, " ").trim().slice(0, 40);
    return { nonWhitespaceChars, sample };
  })();
  context.measurements.set(key, measurement);
  return measurement;
}
