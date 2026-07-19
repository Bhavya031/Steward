import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createWorkflowCatalogSender, createWsBridge } from "./ws-bridge.ts";
import type { runEngineEvent } from "./ws-engine.ts";
import { parseClientEvent, type ServerEvent } from "./ws-events.ts";
import { RECIPES_DIRECTORY } from "./recipes.ts";
import type { AtomicRecipe } from "./recipe-types.ts";

type EngineRunner = typeof runEngineEvent;

class FakeSocket {
  messages: ServerEvent[] = [];
  rawMessages: string[] = [];
  send(raw: string): void {
    this.rawMessages.push(raw);
    this.messages.push(JSON.parse(raw) as ServerEvent);
  }
}

function legacyCatalogRecords(): AtomicRecipe[] {
  return readdirSync(RECIPES_DIRECTORY).filter((name) => name.endsWith(".json")).sort().map((name) => {
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
        replaced_service: raw.replaced_service, monthly_price: raw.monthly_price,
      } : {}),
      ...(raw.derivations ? { derivations: raw.derivations } : {}),
      ...(raw.intermediates ? { intermediates: raw.intermediates } : {}),
      ...(raw.resources ? { resources: raw.resources } : {}),
    };
  });
}

describe("typed WebSocket protocol", () => {
  test("parses only the three exact client event shapes", () => {
    expect(parseClientEvent('{"type":"run_task","task":"compress it","files":["/tmp/a.mp4"]}'))
      .toEqual({ type: "run_task", task: "compress it", files: ["/tmp/a.mp4"] });
    expect(parseClientEvent(
      '{"type":"run_saved_workflow","workflow_id":"compress-video","files":["/tmp/b.mp4"]}',
    )).toEqual({
      type: "run_saved_workflow", workflow_id: "compress-video", files: ["/tmp/b.mp4"],
    });
    expect(parseClientEvent('{"type":"confirm_install","run_id":"run-1","confirm":true}'))
      .toEqual({ type: "confirm_install", run_id: "run-1", confirm: true });
    expect(() => parseClientEvent(
      '{"type":"confirm_install","run_id":"run-1","confirm":false}',
    )).toThrow("unsupported WebSocket message shape");
    expect(() => parseClientEvent(
      '{"type":"run_saved_workflow","workflow_id":"../escape","files":["/tmp/a.mp4"]}',
    )).toThrow("lowercase slug");
    expect(() => parseClientEvent(
      '{"type":"run_saved_workflow","workflow_id":"compress-video","files":["/tmp/a.mp4"],"task":"ignore"}',
    )).toThrow("unsupported WebSocket message shape");
    expect(() => parseClientEvent('{"type":"run_task","task":"x","files":[],"extra":true}'))
      .toThrow("unsupported WebSocket message shape");
    expect(() => parseClientEvent("not json")).toThrow("valid JSON");
  });

  test("sends the real validated saved-workflow catalog", () => {
    const socket = new FakeSocket();
    createWorkflowCatalogSender()(socket);
    const expected: ServerEvent = { type: "workflow_catalog", workflows: legacyCatalogRecords() };
    expect(expected.workflows).toHaveLength(7);
    expect(socket.messages).toHaveLength(1);
    expect(socket.messages[0]).toEqual(expected);
    expect(socket.rawMessages).toEqual([JSON.stringify(expected)]);
    const catalog = socket.messages[0];
    if (catalog?.type !== "workflow_catalog") throw new Error("catalog was not sent");
    expect(catalog.workflows.length).toBeGreaterThan(0);
    expect(catalog.workflows.every((workflow) =>
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(workflow.name)
    )).toBe(true);
  });

  test("passes a stable-ID direct rerun to the engine without task text", async () => {
    const socket = new FakeSocket();
    const runner: EngineRunner = async (request, emit) => {
      expect(request).toEqual({
        type: "run_saved_workflow",
        workflow_id: "compress-video",
        files: ["/tmp/new.mp4"],
      });
      expect(Object.hasOwn(request, "task")).toBe(false);
      emit({
        type: "workflow_selected", run_id: "direct",
        workflow_id: "compress-video", model_calls: 0,
      });
      emit({
        type: "run_complete", run_id: "direct",
        success: true, output_path: "/tmp/new-compressed.mp4", model_calls: 0,
      });
    };
    await createWsBridge({ runEngine: runner })(
      socket,
      '{"type":"run_saved_workflow","workflow_id":"compress-video","files":["/tmp/new.mp4"]}',
    );
    expect(socket.messages).toEqual([
      {
        type: "workflow_selected", run_id: "direct",
        workflow_id: "compress-video", model_calls: 0,
      },
      {
        type: "run_complete", run_id: "direct",
        success: true, output_path: "/tmp/new-compressed.mp4", model_calls: 0,
      },
    ]);
  });

  test("keeps paused installation state on the same socket for automatic continuation", async () => {
    const runner: EngineRunner = async (request, emit, options) => {
      const pendingRuns = options?.pendingRuns;
      if (!pendingRuns) throw new Error("bridge did not provide pending state");
      if (request.type === "run_task") {
        pendingRuns.set("paused", {} as never);
        emit({ type: "model_call_count", run_id: "paused", model_calls: 1 });
        emit({
          type: "install_required", run_id: "paused", tool: null, command: null,
          resources: [{
            id: "whisper-large-v3-turbo", bytes: 1_624_555_275,
            sha256: "sha", source: "official",
          }],
        });
        return;
      }
      if (request.type !== "confirm_install") throw new Error("expected confirmation");
      expect(pendingRuns.has(request.run_id)).toBe(true);
      emit({
        type: "install_complete", run_id: request.run_id,
        message: "Installation verified. Continuing automatically.",
      });
      emit({
        type: "run_complete", run_id: request.run_id,
        success: true, model_calls: 1,
      });
    };
    const socket = new FakeSocket();
    const bridge = createWsBridge({ runEngine: runner });
    await bridge(socket, '{"type":"run_task","task":"subtitles","files":["/tmp/a.mp4"]}');
    await bridge(socket, '{"type":"confirm_install","run_id":"paused","confirm":true}');
    expect(socket.messages.map((event) => event.type)).toEqual([
      "model_call_count", "install_required", "install_complete", "run_complete",
    ]);
    expect(socket.messages.at(-1)).toMatchObject({ model_calls: 1 });
  });

  test("serializes engine events and refuses overlapping runs per socket", async () => {
    let release!: () => void;
    const paused = new Promise<void>((resolve) => { release = resolve; });
    const runner: EngineRunner = async (_request, emit) => {
      emit({ type: "run_started", run_id: "run-1", action: "task", files: ["/tmp/a.mp4"] });
      await paused;
      emit({ type: "run_complete", run_id: "run-1", success: true });
    };
    const bridge = createWsBridge({ runEngine: runner });
    const socket = new FakeSocket();
    const first = bridge(socket, '{"type":"run_task","task":"compress","files":["/tmp/a.mp4"]}');
    await Promise.resolve();
    await bridge(socket, '{"type":"run_task","task":"again","files":["/tmp/a.mp4"]}');
    expect(socket.messages.map((event) => event.type)).toEqual(["run_started", "error"]);
    expect(socket.messages[1]).toMatchObject({ message: "a run is already active on this connection" });
    release();
    await first;
    expect(socket.messages.at(-1)).toMatchObject({ type: "run_complete", success: true });
  });

  test("returns a typed error for malformed client data", async () => {
    const socket = new FakeSocket();
    await createWsBridge()(socket, "not json");
    expect(socket.messages).toEqual([{ type: "error", message: "WebSocket message must be valid JSON" }]);
  });
});
