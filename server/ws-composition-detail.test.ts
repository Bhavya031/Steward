import { afterAll, describe, expect, test } from "bun:test";
import {
  copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createComposition } from "./composition-builder.ts";
import { startLocalServer } from "./local-server.ts";
import { load, RECIPES_DIRECTORY } from "./recipes.ts";
import { createWorkflowCatalogSender, createWsBridge } from "./ws-bridge.ts";
import { runEngineEvent } from "./ws-engine.ts";
import {
  parseClientEvent, type ServerEvent, type WsServerEvent,
} from "./ws-events.ts";

const root = mkdtempSync(join(tmpdir(), "steward-composition-detail-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

class FakeSocket {
  messages: WsServerEvent[] = [];
  rawMessages: string[] = [];

  send(raw: string): void {
    this.rawMessages.push(raw);
    this.messages.push(JSON.parse(raw) as WsServerEvent);
  }
}

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

function detailEvent(events: WsServerEvent[]) {
  const event = events.find((candidate) => candidate.type === "composition_detail");
  if (!event || event.type !== "composition_detail") {
    throw new Error("composition detail event missing");
  }
  return event;
}

describe("authoritative composition detail protocol", () => {
  test("parses only the exact path-free detail request", () => {
    expect(parseClientEvent(JSON.stringify({
      type: "get_composition_detail",
      workflow_id: "media-chain",
    }))).toEqual({
      type: "get_composition_detail",
      workflow_id: "media-chain",
    });
    expect(() => parseClientEvent(JSON.stringify({
      type: "get_composition_detail",
      workflow_id: "media-chain",
      stages: [],
    }))).toThrow("unsupported WebSocket message shape");
    expect(() => parseClientEvent(JSON.stringify({
      type: "get_composition_detail",
      workflow_id: "../media-chain",
    }))).toThrow("lowercase slug");
  });

  test("returns complete ordered snapshots without requiring a prior catalog or client cache", async () => {
    const directory = catalog("fresh-browser");
    const saved = createComposition(selection("media-chain", [
      "convert-media-to-mp4", "compress-video-under-25mb",
    ]), directory);
    const socket = new FakeSocket();
    await createWsBridge({ recipeDirectory: directory })(
      socket,
      JSON.stringify({
        type: "get_composition_detail",
        workflow_id: "media-chain",
      }),
    );
    expect(socket.messages).toHaveLength(1);
    const event = detailEvent(socket.messages);
    expect(event.detail).toMatchObject({
      workflow_id: "media-chain",
      title: "Media Chain",
      created_at: saved.created_at,
      stage_count: 2,
      command_count: 2,
      contract: saved.composition_contract,
      evidence: [],
      history: [],
    });
    expect(event.detail.stages.map((stage) => ({
      stage_index: stage.stage_index,
      source_id: stage.source_id,
      source_title: stage.source_title,
      tools: stage.tools,
      resources: stage.resources,
      command_templates: stage.command_templates,
      output_template: stage.output_template,
      checks: stage.checks.map((check) => ({
        check_id: check.check_id,
        stage_index: check.stage_index,
        check_index: check.check_index,
        source_id: check.source_id,
        name: check.name,
        target: check.target,
      })),
    }))).toEqual(saved.stages.map((stage, stageIndex) => ({
      stage_index: stageIndex,
      source_id: stage.source_id,
      source_title: stage.source_id.split("-").map((word) =>
        `${word.charAt(0).toUpperCase()}${word.slice(1)}`
      ).join(" "),
      tools: [...new Set(stage.command_template.commands.map((command) => command[0]))],
      resources: stage.resources ?? [],
      command_templates: stage.command_template.commands,
      output_template: stage.command_template.output_path,
      checks: stage.checks.map((check, checkIndex) => ({
        check_id: `stage-${stageIndex}-check-${checkIndex}`,
        stage_index: stageIndex,
        check_index: checkIndex,
        source_id: stage.source_id,
        name: check.type,
        target: check.target,
      })),
    })));
  });

  test("returns the server's flattened immutable snapshots for a nested selection", async () => {
    const directory = catalog("nested");
    createComposition(selection("media-chain", [
      "convert-media-to-mp4", "compress-video-under-25mb",
    ]), directory);
    const nested = createComposition(selection("media-to-subtitles", [
      "media-chain", "transcribe-video-to-srt",
    ]), directory);
    const events: WsServerEvent[] = [];
    await runEngineEvent(
      { type: "get_composition_detail", workflow_id: nested.name },
      (event) => events.push(event),
      { recipeDirectory: directory },
    );
    const detail = detailEvent(events).detail;
    expect(detail.stages.map((stage) => stage.source_id)).toEqual([
      "convert-media-to-mp4",
      "compress-video-under-25mb",
      "transcribe-video-to-srt",
    ]);
    expect(detail.stages.map((stage) => stage.command_templates))
      .toEqual(nested.stages.map((stage) => stage.command_template.commands));
    expect(JSON.stringify(detail.stages)).not.toContain("\"stages\"");
  });

  test("keeps duplicate check names distinct by stable stage and source identity", async () => {
    const directory = catalog("duplicate-checks");
    createComposition(selection("media-chain", [
      "convert-media-to-mp4", "compress-video-under-25mb",
    ]), directory);
    const events: WsServerEvent[] = [];
    await runEngineEvent(
      { type: "get_composition_detail", workflow_id: "media-chain" },
      (event) => events.push(event),
      { recipeDirectory: directory },
    );
    const duplicateChecks = detailEvent(events).detail.stages
      .flatMap((stage) => stage.checks)
      .filter((check) => check.name === "duration_matches");
    expect(duplicateChecks).toEqual([
      expect.objectContaining({
        check_id: "stage-0-check-1", stage_index: 0,
        source_id: "convert-media-to-mp4",
      }),
      expect.objectContaining({
        check_id: "stage-1-check-1", stage_index: 1,
        source_id: "compress-video-under-25mb",
      }),
    ]);
  });

  test("rejects unknown and atomic workflow IDs without emitting detail", async () => {
    const directory = catalog("invalid-ids");
    for (const workflowId of ["does-not-exist", "convert-media-to-mp4"]) {
      const socket = new FakeSocket();
      await createWsBridge({ recipeDirectory: directory })(
        socket,
        JSON.stringify({
          type: "get_composition_detail",
          workflow_id: workflowId,
        }),
      );
      expect(socket.messages).toHaveLength(1);
      expect(socket.messages[0]).toMatchObject({
        type: "error",
        message: expect.stringContaining(
          workflowId === "does-not-exist" ? "not found" : "not a composition",
        ),
      });
      expect(socket.messages.some((event) => event.type === "composition_detail")).toBe(false);
    }
  });

  test("keeps serialized detail path-free and free of private protocol state", async () => {
    const directory = catalog("serialization");
    createComposition(selection("media-chain", [
      "convert-media-to-mp4", "compress-video-under-25mb",
    ]), directory);
    const socket = new FakeSocket();
    await createWsBridge({ recipeDirectory: directory })(
      socket,
      '{"type":"get_composition_detail","workflow_id":"media-chain"}',
    );
    expect(socket.rawMessages).toHaveLength(1);
    const serialized = socket.rawMessages[0]!;
    expect(serialized).not.toMatch(
      /(?:\/Users\/|\/private\/|\/tmp\/|output_root|staged_input|capabilit|token|resolved_argv|"argv"|recipe)/i,
    );
    expect(serialized).toContain("{{input_0}}");
    expect(serialized).toContain("{{input_0_dir}}");
  });

  test("leaves legacy atomic catalog serialization byte-for-byte unchanged", () => {
    const directory = catalog("legacy-shape");
    createComposition(selection("media-chain", [
      "convert-media-to-mp4", "compress-video-under-25mb",
    ]), directory);
    const socket = new FakeSocket();
    createWorkflowCatalogSender(directory)(socket);
    const expected: ServerEvent = {
      type: "workflow_catalog",
      workflows: load(directory),
    };
    expect(socket.rawMessages).toEqual([JSON.stringify(expected)]);
  });

  test("the local server rejects unauthenticated detail WebSocket access", async () => {
    const staticRoot = join(root, "auth-static");
    mkdirSync(staticRoot);
    writeFileSync(join(staticRoot, "index.html"), "<main>Steward</main>");
    let delivered = false;
    const running = startLocalServer({
      staticRoot,
      onWebSocketMessage: () => { delivered = true; },
    });
    try {
      const response = await fetch(`${running.origin}/ws`);
      expect(response.status).toBe(401);
      expect(delivered).toBe(false);
    } finally {
      running.server.stop(true);
      rmSync(running.stagingRoot, { recursive: true, force: true });
    }
  });
});
