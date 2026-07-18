export function userFacingMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/\brecipes\b/gi, "saved workflows")
    .replace(/\brecipe\b/gi, "saved workflow");
}
