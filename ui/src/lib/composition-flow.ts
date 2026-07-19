import type {
  ComposableCatalogEntry, CompositionIneligibleReason,
} from "../../../server/composition-catalog.ts";
import type {
  CompositionInputContract, CompositionOutputContract,
} from "../../../server/composition-contract.ts";

export interface CompatibilityRow {
  from: string;
  to: string;
  compatible: boolean;
  reason?: string;
}

const REASONS: Record<CompositionIneligibleReason, string> = {
  ambiguous_or_unsupported_contract: "Input or output format is not explicit enough to combine safely.",
  stage_limit: "This saved command already uses the eight-stage limit.",
  command_limit: "This saved command already uses the eight-command limit.",
};

export function ineligibleReason(entry: ComposableCatalogEntry): string | undefined {
  return entry.eligible ? undefined : REASONS[entry.reason];
}

function compatible(
  output: CompositionOutputContract,
  input: CompositionInputContract,
): string | undefined {
  if (output.family !== input.family) return "Output and next input are different file families.";
  if (!input.accepted_formats.includes(output.format as never)) {
    return `${output.format.toUpperCase()} is not accepted by the next command.`;
  }
  if (output.family === "media" && input.family === "media") {
    const streams = new Set(output.streams);
    if (!input.required_streams.every((stream) => streams.has(stream))) {
      return "The next command requires a stream the previous output does not contain.";
    }
  }
  if (output.family === "document" && input.family === "document" &&
      output.format === "pdf" && input.required_pdf_text_layer !== undefined &&
      output.pdf_text_layer !== input.required_pdf_text_layer) {
    return "The PDF text-layer requirement does not match the previous output.";
  }
  return undefined;
}

function entry(id: string, catalog: ComposableCatalogEntry[]): ComposableCatalogEntry {
  const found = catalog.find((candidate) => candidate.workflow_id === id);
  if (!found) throw new Error(`Saved command is unavailable: ${id}`);
  return found;
}

export function addSelection(
  selected: string[], id: string, catalog: ComposableCatalogEntry[],
): string[] {
  const found = entry(id, catalog);
  if (!found.eligible) throw new Error(ineligibleReason(found));
  if (selected.includes(id)) return selected;
  if (selected.length >= 8) throw new Error("Choose no more than eight saved commands.");
  const chosen = [...selected, id].map((value) => entry(value, catalog));
  if (chosen.reduce((total, item) => total + item.stage_count, 0) > 8) {
    throw new Error("The combined command would exceed eight stages.");
  }
  if (chosen.reduce((total, item) => total + item.command_count, 0) > 8) {
    throw new Error("The combined command would exceed eight commands.");
  }
  return [...selected, id];
}

export function removeSelection(selected: string[], id: string): string[] {
  return selected.filter((value) => value !== id);
}

export function moveSelection(selected: string[], index: number, offset: -1 | 1): string[] {
  const target = index + offset;
  if (index < 0 || index >= selected.length || target < 0 || target >= selected.length) {
    return selected;
  }
  const reordered = [...selected];
  [reordered[index], reordered[target]] = [reordered[target]!, reordered[index]!];
  return reordered;
}

export function compatibilityRows(
  selected: string[], catalog: ComposableCatalogEntry[],
): CompatibilityRow[] {
  return selected.slice(0, -1).map((id, index) => {
    const left = entry(id, catalog);
    const right = entry(selected[index + 1]!, catalog);
    if (!left.eligible || !right.eligible) {
      return { from: id, to: right.workflow_id, compatible: false, reason: "Command is ineligible." };
    }
    const reason = compatible(left.contract.output, right.contract.input);
    return {
      from: id, to: right.workflow_id, compatible: reason === undefined,
      ...(reason ? { reason } : {}),
    };
  });
}

export function canonicalCompositionName(value: string): string | undefined {
  const name = value.trim();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) && name.length <= 64
    ? name : undefined;
}

export function canRunComposition(
  name: string, selected: string[], files: File[],
  catalog: ComposableCatalogEntry[], busy: boolean,
): boolean {
  return !busy && canonicalCompositionName(name) !== undefined &&
    selected.length >= 2 && selected.length <= 8 && files.length === 1 &&
    compatibilityRows(selected, catalog).every((row) => row.compatible);
}
