import { afterAll, describe, expect, test } from "bun:test";
import {
  copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildComposition, createComposition } from "./composition-builder.ts";
import { persistRecipe } from "./recipe-persistence.ts";
import type { CompositionRecipe } from "./recipe-types.ts";
import { validateRecipe } from "./recipe-validation.ts";
import { load, loadSaved, RECIPES_DIRECTORY } from "./recipes.ts";
import { createWorkflowCatalogSender } from "./ws-bridge.ts";

const root = mkdtempSync(join(tmpdir(), "steward-composition-builder-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function catalog(name: string): string {
  const directory = join(root, name);
  mkdirSync(directory);
  for (const file of readdirSync(RECIPES_DIRECTORY).filter((item) => item.endsWith(".json"))) {
    copyFileSync(join(RECIPES_DIRECTORY, file), join(directory, file));
  }
  return directory;
}

function selection(name: string, workflowIds: string[]) {
  return { name, workflow_ids: workflowIds, arch: "arm64" };
}

describe("authoritative composition builder", () => {
  test("resolves stable IDs and creates ordered immutable snapshots", () => {
    const directory = catalog("ordered");
    const built = buildComposition(selection("media-chain", [
      "convert-media-to-mp4", "compress-video-under-25mb",
    ]), directory);
    expect(built.stages.map((stage) => stage.source_id)).toEqual([
      "convert-media-to-mp4", "compress-video-under-25mb",
    ]);
    expect(built.stages.every((stage) => stage.composition_contract !== undefined)).toBe(true);
  });

  test("rejects nonexistent, duplicate, and self selections", () => {
    const directory = catalog("invalid-ids");
    expect(() => buildComposition(selection("missing-chain", [
      "convert-media-to-mp4", "does-not-exist",
    ]), directory)).toThrow("saved workflow not found");
    expect(() => buildComposition(selection("duplicate-chain", [
      "convert-media-to-mp4", "convert-media-to-mp4",
    ]), directory)).toThrow("duplicate workflow selection");
    expect(() => buildComposition(selection("convert-media-to-mp4", [
      "convert-media-to-mp4", "compress-video-under-25mb",
    ]), directory)).toThrow("cannot select itself");
    const clientAuthoredSnapshot = {
      ...selection("authored-snapshot", [
        "convert-media-to-mp4", "compress-video-under-25mb",
      ]),
      source_id: "convert-media-to-mp4",
    };
    expect(() => buildComposition(clientAuthoredSnapshot, directory)).toThrow("selection shape is invalid");
  });

  test("flattens existing compositions without nested persistence", () => {
    const directory = catalog("flatten");
    createComposition(selection("media-chain", [
      "convert-media-to-mp4", "compress-video-under-25mb",
    ]), directory);
    const flattened = buildComposition(selection("media-to-subtitles", [
      "media-chain", "transcribe-video-to-srt",
    ]), directory);
    expect(flattened.stages.map((stage) => stage.source_id)).toEqual([
      "convert-media-to-mp4", "compress-video-under-25mb", "transcribe-video-to-srt",
    ]);
    expect(JSON.stringify(flattened.stages)).not.toContain("\"stages\"");
  });

  test("rejects cyclic and invalid persisted provenance", () => {
    const directory = catalog("cycles");
    const cyclic = buildComposition(selection("cyclic-chain", [
      "convert-media-to-mp4", "compress-video-under-25mb",
    ]), directory);
    cyclic.stages[0]!.source_id = cyclic.name;
    persistRecipe(cyclic, directory);
    expect(() => buildComposition(selection("cycle-consumer", [
      "cyclic-chain", "transcribe-video-to-srt",
    ]), directory)).toThrow("cycle detected");

    const raw = JSON.parse(readFileSync(join(directory, "cyclic-chain.json"), "utf8")) as CompositionRecipe;
    raw.name = "missing-provenance";
    raw.stages[0]!.source_id = "absent-atomic";
    writeFileSync(join(directory, "missing-provenance.json"), JSON.stringify(raw));
    expect(() => buildComposition(selection("provenance-consumer", [
      "missing-provenance", "transcribe-video-to-srt",
    ]), directory)).toThrow("provenance is missing");
  });

  test("persisted snapshots do not depend on live source records", () => {
    const directory = catalog("immutable");
    const saved = createComposition(selection("durable-chain", [
      "convert-media-to-mp4", "compress-video-under-25mb",
    ]), directory);
    rmSync(join(directory, "convert-media-to-mp4.json"));
    const reloaded = loadSaved(directory).find((recipe) => recipe.name === saved.name);
    expect(reloaded).toEqual(saved);
  });

  test("keeps compositions out of atomic load, catalog, and direct-rerun validation", () => {
    const directory = catalog("atomic-exclusion");
    const atomicNames = load(directory).map((recipe) => recipe.name);
    const saved = createComposition(selection("excluded-chain", [
      "convert-media-to-mp4", "compress-video-under-25mb",
    ]), directory);
    expect(load(directory).map((recipe) => recipe.name)).toEqual(atomicNames);
    const messages: string[] = [];
    createWorkflowCatalogSender(directory)({ send: (message) => messages.push(message) });
    const payload = JSON.parse(messages[0]!) as { workflows: Array<{ name: string }> };
    expect(payload.workflows.map((recipe) => recipe.name)).toEqual(atomicNames);
    expect(() => validateRecipe(saved)).toThrow("requires the composition runtime");
  });
});
