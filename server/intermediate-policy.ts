export const TEMP_DIR_SLOT = "{{temp_dir}}";
const TEMP_CHILD = /^\{\{temp_dir\}\}\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export class IntermediateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntermediateValidationError";
  }
}

export function validateIntermediates(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) {
    throw new IntermediateValidationError("intermediates must contain 1 to 8 temp paths when present");
  }
  if (!value.every((path) => typeof path === "string" && TEMP_CHILD.test(path))) {
    throw new IntermediateValidationError(
      `every intermediate must be a direct child of ${TEMP_DIR_SLOT}`,
    );
  }
  if (new Set(value).size !== value.length) {
    throw new IntermediateValidationError("intermediate paths must be unique");
  }
  return [...value];
}
