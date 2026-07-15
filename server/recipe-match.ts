import { extname } from "node:path";
import type { Recipe } from "./recipe-types.ts";

const STOP = new Set(["a", "an", "and", "for", "my", "please", "than", "the", "this", "to"]);
const CANONICAL: Record<string, string> = {
  below: "under", clip: "video", compressing: "compress", compression: "compress",
  compressor: "compress", less: "under", movie: "video", movies: "video",
  reduce: "compress", smaller: "compress", shrink: "compress", shrinking: "compress",
  videos: "video",
};
const FILE_KINDS: Record<string, string> = {
  ".avi": "video", ".mkv": "video", ".mov": "video", ".mp4": "video", ".webm": "video",
  ".aac": "audio", ".flac": "audio", ".m4a": "audio", ".mp3": "audio", ".wav": "audio",
  ".docx": "document", ".md": "document", ".pdf": "document", ".txt": "document",
};

function tokens(value: string): Set<string> {
  const separated = value.toLowerCase()
    .replace(/([a-z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([a-z])/g, "$1 $2")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((token) => CANONICAL[token] ?? token)
    .filter((token) => !STOP.has(token));
  return new Set(separated);
}

export function recipeConfidence(recipe: Recipe, taskDescription: string, files: string[]): number {
  const query = tokens(taskDescription);
  if (query.size === 0) return 0;
  const recipeWords = tokens([
    recipe.name, recipe.replaced_service, recipe.tool,
    ...recipe.checks.map((check) => check.type),
  ].join(" "));
  const overlap = [...query].filter((token) => recipeWords.has(token)).length;
  const coverage = overlap / query.size;
  const precision = overlap / Math.max(1, recipeWords.size);
  const fileKind = files.map((file) => FILE_KINDS[extname(file).toLowerCase()]).find(Boolean);
  const compatibility = fileKind && recipeWords.has(fileKind) ? 0.05 : 0;
  return Math.min(1, Number((coverage * 0.85 + precision * 0.15 + compatibility).toFixed(3)));
}
