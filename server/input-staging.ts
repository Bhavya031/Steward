import { randomUUID } from "node:crypto";
import { realpathSync, rmSync, statSync } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";

export const STAGE_INPUT_PATH = "/api/stage-input";
const FILENAME_HEADER = "x-steward-filename";

function inside(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child !== "" && !child.startsWith("..") && !child.startsWith("/");
}

function stagedFilename(request: Request): string {
  const encoded = request.headers.get(FILENAME_HEADER);
  if (!encoded || encoded.length > 1_024) throw new Error("A staged filename is required.");
  let name: string;
  try {
    name = decodeURIComponent(encoded).normalize("NFC");
  } catch {
    throw new Error("The staged filename is invalid.");
  }
  if (!name || name.length > 255 || name === "." || name === ".." ||
      name !== basename(name) || /[\/\\\0]/.test(name)) {
    throw new Error("The staged filename must be a plain filename.");
  }
  const safe = name.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "").slice(0, 180);
  if (!safe) throw new Error("The staged filename has no safe characters.");
  return `${randomUUID()}-${safe}`;
}

async function writeChunk(handle: FileHandle, chunk: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset);
    if (bytesWritten <= 0) throw new Error("The staged upload stopped before completion.");
    offset += bytesWritten;
  }
}

export async function stageInput(request: Request, stagingRoot: string): Promise<Response> {
  let destination: string | undefined;
  let handle: FileHandle | undefined;
  try {
    const root = realpathSync(stagingRoot);
    destination = resolve(root, stagedFilename(request));
    if (!inside(root, destination) || dirname(destination) !== root) {
      throw new Error("The staged input path escaped its temporary root.");
    }
    handle = await open(destination, "wx", 0o600);
    const reader = request.body?.getReader();
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writeChunk(handle, value);
      }
    }
    await handle.close();
    handle = undefined;
    const real = realpathSync(destination);
    if (!inside(root, real) || !statSync(real).isFile()) {
      throw new Error("The staged input is not a confined regular file.");
    }
    return Response.json({ path: real }, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (destination) rmSync(destination, { force: true });
    return Response.json({
      error: error instanceof Error ? error.message : String(error),
    }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
