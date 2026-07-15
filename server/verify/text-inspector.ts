import { closeSync, openSync, readSync, statSync } from "node:fs";
import { validateMediaPath } from "../ffprobe-policy.ts";

export interface TextInspection {
  valid: boolean;
  bytes: number;
  nonWhitespaceChars: number;
  sample: string;
  error?: string;
}

export function inspectUtf8(inputPath: string): TextInspection {
  const path = validateMediaPath(inputPath);
  const bytes = statSync(path).size;
  if (bytes === 0) return { valid: false, bytes, nonWhitespaceChars: 0, sample: "", error: "empty file" };
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const buffer = Buffer.alloc(64 * 1_024);
  const fd = openSync(path, "r");
  let nonWhitespaceChars = 0;
  let sampleSource = "";
  const consume = (text: string): void => {
    for (const character of text) if (/\S/u.test(character)) nonWhitespaceChars += 1;
    if (sampleSource.length < 1_024) sampleSource += text.slice(0, 1_024 - sampleSource.length);
  };
  try {
    while (true) {
      const count = readSync(fd, buffer, 0, buffer.length, null);
      if (count === 0) break;
      consume(decoder.decode(buffer.subarray(0, count), { stream: true }));
    }
    consume(decoder.decode());
    return {
      valid: true,
      bytes,
      nonWhitespaceChars,
      sample: sampleSource.replace(/\s+/g, " ").trim().slice(0, 40),
    };
  } catch {
    return { valid: false, bytes, nonWhitespaceChars: 0, sample: "", error: "invalid UTF-8" };
  } finally {
    closeSync(fd);
  }
}
