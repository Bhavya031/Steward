import type { PlanCheck } from "../../../server/plan.ts";
import type { ClientEvent } from "../../../server/ws-events.ts";
import type { RunHistoryItem } from "./stores.ts";

export interface TemplateFragment {
  text: string;
  slot: boolean;
}

export function templateFragments(value: string): TemplateFragment[] {
  return value.split(/(\{\{[a-z0-9_]+\}\})/g)
    .filter(Boolean)
    .map((text) => ({ text, slot: /^\{\{[a-z0-9_]+\}\}$/.test(text) }));
}

export function displayArgument(value: string): string {
  if (/^[a-zA-Z0-9_./:+,=@%{}-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function checkAssertion(check: PlanCheck): string {
  const target = String(check.target);
  switch (check.type) {
    case "size_under":
      return `Output is smaller than ${target} bytes.`;
    case "duration_matches":
      return `Output duration matches ${target === "{{input_0}}" ? "the input file" : target}.`;
    case "streams_present":
      return `Output contains every required stream: ${target}.`;
    case "plays":
      return "A full frame scan completes without decode errors.";
    case "audio_stream_present":
      return "Output contains at least one audio stream.";
    case "loudness_matches":
      return `Integrated loudness is within ±1.0 LUFS of ${target} LUFS.`;
    case "true_peak_under":
      return `True peak is at or below ${target} dBTP.`;
    case "file_valid":
      return `Output is structurally valid ${target.toUpperCase()}.`;
    case "page_count_positive":
      return `Output contains at least ${target} page${check.target === 1 ? "" : "s"}.`;
    case "text_extractable":
      return `At least ${target} non-whitespace characters can be extracted.`;
    case "format_matches":
      return `Detected output format is ${target.toUpperCase()}.`;
  }
}

export function formatPrice(price: number): string {
  return Number.isInteger(price) ? price.toFixed(0) : price.toFixed(2);
}

export function runAgainEvent(
  recipeName: string,
  history: RunHistoryItem[],
): Extract<ClientEvent, { type: "run_recipe" }> | undefined {
  const latest = [...history].reverse().find((run) => run.files.length > 0);
  return latest
    ? { type: "run_recipe", name: recipeName, files: [...latest.files] }
    : undefined;
}
