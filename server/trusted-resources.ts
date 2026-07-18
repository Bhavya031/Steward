import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const TRUSTED_RESOURCES = {
  "whisper-large-v3-turbo": {
    filename: "ggml-large-v3-turbo.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
    bytes: 1_624_555_275,
    sha256: "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69",
    source: "ggerganov/whisper.cpp",
  },
} as const;

export type TrustedResourceId = keyof typeof TRUSTED_RESOURCES;
export interface ResourceProgress {
  id: TrustedResourceId;
  received: number;
  total: number;
}
const verified = new Map<string, { size: number; mtimeMs: number }>();

export function resourceDirectory(): string {
  return process.env.STEWARD_RESOURCE_DIR ??
    join(homedir(), "Library", "Caches", "Steward", "models");
}

export function resourcePath(id: TrustedResourceId): string {
  return join(resourceDirectory(), TRUSTED_RESOURCES[id].filename);
}

export function resourceSlot(id: TrustedResourceId): string {
  return `resource_${id.replaceAll("-", "_")}`;
}

export function validateResources(value: unknown): TrustedResourceId[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 4) {
    throw new Error("resources must contain 1 to 4 trusted resource IDs when present");
  }
  if (!value.every((id) => typeof id === "string" && Object.hasOwn(TRUSTED_RESOURCES, id))) {
    throw new Error("resource ID is not trusted");
  }
  if (new Set(value).size !== value.length) throw new Error("resource IDs must be unique");
  return [...value] as TrustedResourceId[];
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function resourceIsValid(id: TrustedResourceId): Promise<boolean> {
  const path = resourcePath(id);
  if (!existsSync(path) || !statSync(path).isFile()) return false;
  const expected = TRUSTED_RESOURCES[id];
  const status = statSync(path);
  if (status.size !== expected.bytes) return false;
  const cached = verified.get(path);
  if (cached?.size === status.size && cached.mtimeMs === status.mtimeMs) return true;
  if (await sha256(path) !== expected.sha256) return false;
  verified.set(path, { size: status.size, mtimeMs: status.mtimeMs });
  return true;
}

export async function installResource(
  id: TrustedResourceId,
  onProgress: (progress: ResourceProgress) => void = () => undefined,
  fetcher: (url: string) => Promise<Response> = (url) => fetch(url),
): Promise<string> {
  const metadata = TRUSTED_RESOURCES[id];
  mkdirSync(resourceDirectory(), { recursive: true });
  const destination = resourcePath(id);
  const temporary = `${destination}.download`;
  rmSync(temporary, { force: true });
  const response = await fetcher(metadata.url);
  if (!response.ok || !response.body) throw new Error(`model download failed with HTTP ${response.status}`);
  const file = Bun.file(temporary).writer();
  const hash = createHash("sha256");
  let received = 0;
  let closed = false;
  try {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const bytes = value;
      file.write(bytes);
      hash.update(bytes);
      received += bytes.byteLength;
      onProgress({ id, received, total: metadata.bytes });
    }
    file.end();
    closed = true;
    if (received !== metadata.bytes) throw new Error(`model size mismatch: expected ${metadata.bytes}, got ${received}`);
    const actual = hash.digest("hex");
    if (actual !== metadata.sha256) throw new Error(`model SHA-256 mismatch: expected ${metadata.sha256}, got ${actual}`);
    renameSync(temporary, destination);
    const status = statSync(destination);
    verified.set(destination, { size: status.size, mtimeMs: status.mtimeMs });
    return destination;
  } catch (error) {
    if (!closed) file.end();
    rmSync(temporary, { force: true });
    throw error;
  }
}

export async function resourceSlots(
  ids: TrustedResourceId[] = [],
): Promise<{ slots: Record<string, string>; trustedPaths: string[]; missing: TrustedResourceId[] }> {
  const slots: Record<string, string> = {};
  const trustedPaths: string[] = [];
  const missing: TrustedResourceId[] = [];
  for (const id of ids) {
    if (!await resourceIsValid(id)) {
      missing.push(id);
      continue;
    }
    const path = resourcePath(id);
    slots[resourceSlot(id)] = path;
    trustedPaths.push(path);
  }
  return { slots, trustedPaths, missing };
}

export function fillResourceSlots(
  commands: string[][],
  slots: Record<string, string>,
): string[][] {
  return commands.map((command) => command.map((argument) =>
    argument.replace(/\{\{(resource_[a-z0-9_]+)\}\}/g, (_match, slot: string) => {
      const value = slots[slot];
      if (!value) throw new Error(`trusted resource is unavailable: ${slot}`);
      return value;
    })
  ));
}
