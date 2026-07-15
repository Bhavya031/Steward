import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

const IMPORTS = [
  /\bfrom\s+["'](\.[^"']+)["']/g,
  /\bimport\s+(["'])(\.[^"']+)\1/g,
  /\bimport\s*\(\s*["'](\.[^"']+)["']\s*\)/g,
];

function dependency(match: RegExpMatchArray): string {
  return match[2] ?? match[1]!;
}

export function relativeSourceGraph(entry: string, root: string): Map<string, string> {
  const canonicalRoot = realpathSync(root);
  const visited = new Map<string, string>();
  const visit = (candidate: string): void => {
    const file = realpathSync(candidate);
    const name = relative(canonicalRoot, file);
    if (name.startsWith("..") || visited.has(name)) return;
    const source = readFileSync(file, "utf8");
    visited.set(name, source);
    for (const pattern of IMPORTS) {
      for (const found of source.matchAll(pattern)) {
        const path = resolve(dirname(file), dependency(found));
        if (path.endsWith(".ts") && existsSync(path)) visit(path);
      }
    }
  };
  visit(entry);
  return visited;
}
