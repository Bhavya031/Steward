import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export interface SofficeProfile {
  argument: string;
  cleanup: () => void;
}

export function createSofficeProfile(): SofficeProfile {
  const directory = mkdtempSync(join(tmpdir(), "steward-soffice-"));
  return {
    argument: `-env:UserInstallation=${pathToFileURL(directory).href}`,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}
