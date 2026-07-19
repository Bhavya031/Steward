import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { composableCatalog } from "./composition-catalog.ts";
import { RECIPES_DIRECTORY } from "./recipes.ts";
import type { AtomicRecipe } from "./recipe-types.ts";
import { relativeSourceGraph } from "./source-graph.ts";
import { StagedInputRegistry } from "./staged-input-registry.ts";
import {
  claimedStagedInputPath, cleanupClaimedStagedInput,
} from "./staged-input-registry.ts";
import { createWorkflowCatalogSender } from "./ws-bridge.ts";
import { runEngineEvent } from "./ws-engine.ts";
import {
  parseClientEvent, type ServerEvent, type WsServerEvent,
} from "./ws-events.ts";

const root = mkdtempSync(join(tmpdir(), "steward-composition-protocol-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function normalizedLegacyCatalogRecords(): AtomicRecipe[] {
  return readdirSync(RECIPES_DIRECTORY)
    .filter((name) => name.endsWith(".json")).sort()
    .map((name) => {
      const raw = JSON.parse(readFileSync(join(RECIPES_DIRECTORY, name), "utf8"));
      return {
        name: raw.name,
        command_template: raw.command_template,
        checks: raw.checks,
        created_at: raw.created_at,
        arch: raw.arch,
        tool: raw.tool,
        install_weight: raw.install_weight,
        ...(raw.task_signature ? { task_signature: raw.task_signature } : {}),
        ...(raw.replaced_service ? {
          replaced_service: raw.replaced_service,
          monthly_price: raw.monthly_price,
        } : {}),
        ...(raw.derivations ? { derivations: raw.derivations } : {}),
        ...(raw.intermediates ? { intermediates: raw.intermediates } : {}),
        ...(raw.resources ? { resources: raw.resources } : {}),
      };
    });
}

describe("saved-command composition protocol boundaries", () => {
  test("preserves the byte/shape-compatible legacy catalog and atomic messages", () => {
    const messages: string[] = [];
    createWorkflowCatalogSender()({ send: (message) => messages.push(message) });
    const expected: ServerEvent = {
      type: "workflow_catalog",
      workflows: normalizedLegacyCatalogRecords(),
    };
    expect(messages).toEqual([JSON.stringify(expected)]);
    expect(parseClientEvent(
      '{"type":"run_saved_workflow","workflow_id":"convert-media-to-mp4","files":["/tmp/a.mov"]}',
    )).toEqual({
      type: "run_saved_workflow",
      workflow_id: "convert-media-to-mp4",
      files: ["/tmp/a.mov"],
    });
  });

  test("exposes eligibility and explicit ineligible reasons only on request", async () => {
    const events: WsServerEvent[] = [];
    await runEngineEvent(
      { type: "get_composable_catalog" },
      (event) => events.push(event),
    );
    expect(events).toEqual([{
      type: "composable_catalog",
      workflows: composableCatalog(),
    }]);
    const catalog = events[0];
    if (catalog?.type !== "composable_catalog") throw new Error("catalog missing");
    expect(catalog.workflows.find(({ workflow_id }) =>
      workflow_id === "convert-media-to-mp4"
    )).toMatchObject({ eligible: true, kind: "atomic", contract: expect.any(Object) });
    expect(catalog.workflows.find(({ workflow_id }) =>
      workflow_id === "convert-markdown-to-docx"
    )).toEqual({
      workflow_id: "convert-markdown-to-docx",
      kind: "atomic",
      eligible: false,
      stage_count: 1,
      command_count: 1,
      reason: "ambiguous_or_unsupported_contract",
    });
  });

  test("accepts only path-free exact composition request shapes", () => {
    const staged = "d9428888-122b-4e7f-a15b-3f708bc090f1";
    expect(parseClientEvent(JSON.stringify({
      type: "run_composition",
      name: "media-chain",
      workflow_ids: ["convert-media-to-mp4", "transcribe-video-to-srt"],
      staged_input_id: staged,
    }))).toEqual({
      type: "run_composition",
      name: "media-chain",
      workflow_ids: ["convert-media-to-mp4", "transcribe-video-to-srt"],
      staged_input_id: staged,
    });
    expect(parseClientEvent(JSON.stringify({
      type: "run_saved_workflow",
      workflow_id: "media-chain",
      staged_input_id: staged,
    }))).toEqual({
      type: "run_saved_workflow", workflow_id: "media-chain", staged_input_id: staged,
    });
    for (const extra of ["snapshots", "contracts", "output_root", "source_id", "files"]) {
      expect(() => parseClientEvent(JSON.stringify({
        type: "run_composition",
        name: "media-chain",
        workflow_ids: ["convert-media-to-mp4", "transcribe-video-to-srt"],
        staged_input_id: staged,
        [extra]: extra === "files" ? ["/tmp/private.mov"] : {},
      }))).toThrow("unsupported WebSocket message shape");
    }
    expect(() => parseClientEvent(JSON.stringify({
      type: "run_composition",
      name: "media-chain",
      workflow_ids: ["convert-media-to-mp4", "convert-media-to-mp4"],
      staged_input_id: staged,
    }))).toThrow("must be unique");
    expect(() => parseClientEvent(JSON.stringify({
      type: "run_composition",
      name: "media-chain",
      workflow_ids: ["convert-media-to-mp4"],
      staged_input_id: staged,
    }))).toThrow("2 to 8");
    expect(() => parseClientEvent(JSON.stringify({
      type: "run_composition",
      name: "media-chain",
      workflow_ids: ["convert-media-to-mp4", "transcribe-video-to-srt"],
      staged_input_id: "/tmp/private.mov",
    }))).toThrow("opaque server-issued ID");
    expect(() => parseClientEvent(`${JSON.stringify({
      type: "get_composable_catalog",
    })}${" ".repeat(64 * 1_024)}`)).toThrow("exceeds 64 KiB");
  });

  test("claims only one server-staged regular file and rejects reuse or forgery", () => {
    const staging = new StagedInputRegistry(join(root, "staged"));
    const input = join(staging.root, "input.mov");
    const outside = join(root, "outside.mov");
    writeFileSync(input, "staged");
    writeFileSync(outside, "outside");
    const id = staging.register(input);
    expect(staging.has(id)).toBe(true);
    const lease = staging.claim(id);
    expect(claimedStagedInputPath(lease)).toBe(input);
    expect(staging.has(id)).toBe(false);
    expect(() => staging.claim(id)).toThrow("already used");
    expect(() => staging.claim("00000000-0000-4000-8000-000000000000"))
      .toThrow("unknown");
    expect(() => staging.register(outside)).toThrow("outside");
    cleanupClaimedStagedInput(lease);
    expect(existsSync(input)).toBe(false);
  });

  test("composition protocol graph cannot reach planner, agent, Codex, or GPT", () => {
    const graph = relativeSourceGraph(
      resolve(import.meta.dir, "ws-composition.ts"),
      resolve(import.meta.dir, ".."),
    );
    const modules = [...graph.keys()];
    expect(modules).toContain("server/composition-runtime.ts");
    expect(modules.some((name) =>
      name.includes("agent") || name.includes("repair-loop")
    )).toBe(false);
    expect([...graph.values()].join("\n")).not.toMatch(/\bCodex\b|\bgpt-[a-z0-9.-]+/i);
  });
});
