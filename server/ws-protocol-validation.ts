export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

export function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0") || value.length > 2_000) {
    throw new Error(`${label} must be a non-empty string up to 2,000 characters`);
  }
  return value;
}

export function files(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
    throw new Error("files must contain 1 to 32 paths");
  }
  return value.map((path, index) => text(path, `files[${index}]`));
}

export function workflowId(value: unknown, label = "workflow_id"): string {
  const id = text(value, label);
  if (id.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new Error(`${label} must be a lowercase slug up to 64 characters`);
  }
  return id;
}

export function workflowIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 8) {
    throw new Error("workflow_ids must contain 2 to 8 stable workflow IDs");
  }
  const ids = value.map((id, index) => workflowId(id, `workflow_ids[${index}]`));
  if (new Set(ids).size !== ids.length) throw new Error("workflow_ids must be unique");
  return ids;
}

export function stagedInputId(value: unknown): string {
  const id = text(value, "staged_input_id");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
    throw new Error("staged_input_id must be an opaque server-issued ID");
  }
  return id;
}
