import { createHash } from "node:crypto";
import { extname } from "node:path";
import { mediaFormat, mediaTargetFromConversionPhrase, type MediaFormat } from "./media-formats.ts";
import type { Recipe } from "./recipe-types.ts";

export type RecipeIntent = "compression" | "conversion";

const STOP = new Set(["a", "an", "and", "for", "my", "please", "than", "the", "this", "to"]);
const CANONICAL: Record<string, string> = {
  below: "under", clip: "video", compressing: "compress", compression: "compress",
  compressor: "compress", less: "under", movie: "video", movies: "video",
  reduce: "compress", smaller: "compress", shrink: "compress", shrinking: "compress",
  scan: "ocr", scanned: "ocr", searchable: "ocr", videos: "video",
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

export function normalizeSemanticTask(value: string): string {
  return value.normalize("NFKC").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function semanticTaskSignature(value: string): string {
  return `sha256:${createHash("sha256").update(normalizeSemanticTask(value)).digest("hex")}`;
}

export function recipeIntent(recipe: Recipe): RecipeIntent | null {
  if (recipe.checks.some((check) => check.type === "size_under")) return "compression";
  return recipeMediaTarget(recipe) ? "conversion" : null;
}

export function recipeMediaTarget(recipe: Recipe): MediaFormat | null {
  return mediaFormat(recipe.checks.find((check) => check.type === "format_matches")?.target);
}

export function taskIntent(task: string): RecipeIntent | null {
  const compression = /\b(?:compress(?:ed|ing|ion)?|smaller|shrink)\b/i.test(task) ||
    /\b\d+(?:\.\d+)?\s*(?:kb|mb|gb)\b/i.test(task);
  const conversionVerb = /\b(?:convert|turn)\b/i.test(task);
  const conversionTarget = mediaTargetFromConversionPhrase(task) !== null;
  if (compression && (conversionVerb || conversionTarget)) return null;
  if (conversionTarget) return "conversion";
  return compression ? "compression" : null;
}

function compatibleIntent(recipe: Recipe, taskDescription: string): boolean {
  const requested = taskIntent(taskDescription);
  const capability = recipeIntent(recipe);
  if ((requested || capability) && requested !== capability) return false;
  return requested !== "conversion" ||
    mediaTargetFromConversionPhrase(taskDescription) === recipeMediaTarget(recipe);
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
  const lexical = Math.min(1, coverage * 0.85 + precision * 0.15 + compatibility);
  const requested = taskIntent(taskDescription);
  if (!requested) return Number(lexical.toFixed(3));
  const capability = recipeIntent(recipe);
  const requestedFormat = mediaTargetFromConversionPhrase(taskDescription);
  const wrongFormat = requested === "conversion" && requestedFormat !== null &&
    recipeMediaTarget(recipe) !== requestedFormat;
  const scored = capability === requested && !wrongFormat ? 0.7 + lexical * 0.3 : lexical * 0.3;
  return Number(Math.min(1, scored).toFixed(3));
}

export function exactTaskRecipe(
  recipes: Recipe[], taskDescription: string,
): Recipe | null | undefined {
  const signature = semanticTaskSignature(taskDescription);
  const exact = recipes.filter((recipe) => recipe.task_signature === signature);
  if (exact.length === 0) return undefined;
  if (exact.length !== 1 || !compatibleIntent(exact[0]!, taskDescription)) return null;
  return exact[0]!;
}

export function recipeMatchesIntent(recipe: Recipe, taskDescription: string): boolean {
  return compatibleIntent(recipe, taskDescription);
}
