import { closeSync, openSync, readSync, statSync } from "node:fs";
import { validateMediaPath } from "../ffprobe-policy.ts";

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX_TAIL = 65_557;
const MAX_CENTRAL = 64 * 1_024 * 1_024;

export interface ZipInspection {
  valid: boolean;
  names: Set<string>;
  error?: string;
}

function readAt(fd: number, length: number, position: number): Buffer {
  const buffer = Buffer.alloc(length);
  const count = readSync(fd, buffer, 0, length, position);
  if (count !== length) throw new Error("truncated ZIP structure");
  return buffer;
}

function findEocd(tail: Buffer): number {
  for (let offset = tail.length - 22; offset >= 0; offset -= 1) {
    if (tail.readUInt32LE(offset) !== EOCD) continue;
    const comment = tail.readUInt16LE(offset + 20);
    if (offset + 22 + comment === tail.length) return offset;
  }
  return -1;
}

export function inspectZip(inputPath: string): ZipInspection {
  const path = validateMediaPath(inputPath);
  const size = statSync(path).size;
  const names = new Set<string>();
  if (size < 22) return { valid: false, names, error: "ZIP end record missing" };
  const fd = openSync(path, "r");
  try {
    const tailSize = Math.min(size, MAX_TAIL);
    const tail = readAt(fd, tailSize, size - tailSize);
    const eocd = findEocd(tail);
    if (eocd < 0) return { valid: false, names, error: "ZIP end record missing" };
    const entries = tail.readUInt16LE(eocd + 10);
    const centralSize = tail.readUInt32LE(eocd + 12);
    const centralOffset = tail.readUInt32LE(eocd + 16);
    if (entries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
      return { valid: false, names, error: "ZIP64 is unsupported" };
    }
    if (entries > 100_000 || centralSize > MAX_CENTRAL || centralOffset + centralSize > size) {
      return { valid: false, names, error: "ZIP central directory is out of bounds" };
    }
    let cursor = centralOffset;
    const centralEnd = centralOffset + centralSize;
    for (let index = 0; index < entries; index += 1) {
      const header = readAt(fd, 46, cursor);
      if (header.readUInt32LE(0) !== CENTRAL) throw new Error("invalid ZIP central header");
      const nameLength = header.readUInt16LE(28);
      const extraLength = header.readUInt16LE(30);
      const commentLength = header.readUInt16LE(32);
      const localOffset = header.readUInt32LE(42);
      const next = cursor + 46 + nameLength + extraLength + commentLength;
      if (next > centralEnd || localOffset + 4 > size) throw new Error("ZIP entry is out of bounds");
      const local = readAt(fd, 4, localOffset);
      if (local.readUInt32LE(0) !== LOCAL) throw new Error("invalid ZIP local header");
      names.add(readAt(fd, nameLength, cursor + 46).toString("utf8"));
      cursor = next;
    }
    if (cursor > centralEnd) throw new Error("ZIP central directory overflow");
    return { valid: true, names };
  } catch (error) {
    return { valid: false, names, error: error instanceof Error ? error.message : String(error) };
  } finally {
    closeSync(fd);
  }
}
