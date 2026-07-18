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
  const source = target === "{{input_0}}" ? "the input file" : target;
  switch (check.type) {
    case "size_under":
      return `Output is smaller than ${target} bytes.`;
    case "duration_matches":
      return `Output duration matches ${source}.`;
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
    case "page_count_matches":
      return `Output page count matches ${source}.`;
    case "text_extractable":
      return typeof check.target === "number"
        ? `At least ${target} non-whitespace characters can be extracted.`
        : `${source === "the input file" ? "The input file" : `Source ${source}`} has no extractable text and the output does.`;
    case "format_matches":
      return `Detected output format is ${target.toUpperCase()}.`;
    case "srt_valid":
      return "Output is a structurally valid UTF-8 SRT.";
    case "cue_count":
      return `Output contains at least ${target} subtitle cue${check.target === 1 ? "" : "s"}.`;
    case "timestamps_monotonic":
      return "Subtitle timestamps are monotonic and every cue ends after it starts.";
    default: {
      const unsupported: never = check.type;
      return `Verification target ${String(unsupported)} is ${target}.`;
    }
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
