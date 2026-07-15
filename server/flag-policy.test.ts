import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlanTool } from "./plan.ts";
import { validateCommandPaths } from "./path-policy.ts";

const root = mkdtempSync(join(tmpdir(), "steward-flag-policy-"));
const managed = mkdtempSync(join(tmpdir(), "steward-run-policy-"));
const media = join(root, "input.mp4");
const markdown = join(root, "input.md");
writeFileSync(media, "media fixture");
writeFileSync(markdown, "# document fixture\n");
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(managed, { recursive: true, force: true });
});

function rejects(tool: PlanTool, command: string[], input: string, output: string): void {
  expect(() => validateCommandPaths(tool, command, [input], output, {
    temporaryDirectory: managed,
  })).toThrow();
}

describe("positive per-tool flag policy", () => {
  test("rejects the documented Ghostscript pipe exploit", () => {
    const output = join(root, "safe.pdf");
    rejects("gs", ["gs", "-dNOSAFER", "-sDEVICE=pdfwrite",
      "-sOutputFile=%pipe%touch /tmp/pwned", media], media, output);
    rejects("gs", ["gs", "-dSAFER", "-dBATCH", "-dNOPAUSE", "-sDEVICE=pdfwrite",
      "-sOutputFile=%handle%123", media], media, output);
  });

  test("rejects the documented ffmpeg movie source exploit", () => {
    const output = join(root, "safe.mp4");
    rejects("ffmpeg", ["ffmpeg", "-i", media, "-vf",
      "movie=filename=/etc/passwd", output], media, output);
    rejects("ffmpeg", ["ffmpeg", "-i", media, "-af",
      "loudnorm=movie=/etc/passwd:TP=-1", output], media, output);
  });

  test("rejects pandoc executable filters, engines, and templates", () => {
    const output = join(root, "safe.docx");
    for (const dangerous of [
      ["--lua-filter", "evil.lua"], ["--filter", "/tmp/evil"],
      ["--pdf-engine=/tmp/evil"], ["--template=/etc/passwd"],
    ]) rejects("pandoc", ["pandoc", markdown, ...dangerous, "-o", output], markdown, output);
  });

  test("rejects lavfi inputs and -f outputs outside the validated destination", () => {
    const output = join(root, "safe.mp4");
    rejects("ffmpeg", ["ffmpeg", "-f", "lavfi", "-i", "testsrc", output], media, output);
    rejects("ffmpeg", ["ffmpeg", "-i", media, "-f", "mp4", "/tmp/outside.mp4"], media, output);
  });

  test("accepts the legitimate two-pass compression commands", () => {
    const output = join(root, "compressed.mp4");
    const video = ["-map", "0:v:0", "-c:v", "libx264", "-preset", "slow", "-b:v", "800k"];
    const passlog = join(managed, "ffmpeg2pass");
    validateCommandPaths("ffmpeg", ["ffmpeg", "-i", media, ...video, "-pass", "1",
      "-passlogfile", passlog, "-an", "-f", "null", join(managed, "pass1.null")],
    [media], output, { requireOutput: false, temporaryDirectory: managed });
    validateCommandPaths("ffmpeg", ["ffmpeg", "-i", media, ...video, "-pass", "2",
      "-passlogfile", passlog, "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", output],
    [media], output, { temporaryDirectory: managed });
  });

  test("accepts legitimate loudness normalization and pandoc conversion", () => {
    const audio = join(root, "normalized.m4a");
    validateCommandPaths("ffmpeg", ["ffmpeg", "-i", media, "-af",
      "loudnorm=I=-14:TP=-1:LRA=11", "-c:a", "aac", "-b:a", "192k", audio], [media], audio);
    const document = join(root, "converted.docx");
    validateCommandPaths("pandoc", ["pandoc", markdown, "-f", "markdown", "-t", "docx", "-o", document],
      [markdown], document);
    const pdf = join(root, "compressed.pdf");
    validateCommandPaths("gs", ["gs", "-dSAFER", "-dBATCH", "-dNOPAUSE",
      "-sDEVICE=pdfwrite", `-sOutputFile=${pdf}`, markdown], [markdown], pdf);
  });
});
