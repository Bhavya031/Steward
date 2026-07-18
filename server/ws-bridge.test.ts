import { describe, expect, test } from "bun:test";
import { createWsBridge } from "./ws-bridge.ts";
import type { runEngineEvent } from "./ws-engine.ts";
import { parseClientEvent, type ServerEvent } from "./ws-events.ts";

type EngineRunner = typeof runEngineEvent;

class FakeSocket {
  messages: ServerEvent[] = [];
  send(raw: string): void { this.messages.push(JSON.parse(raw) as ServerEvent); }
}

describe("typed WebSocket protocol", () => {
  test("parses only the three exact client event shapes", () => {
    expect(parseClientEvent('{"type":"run_task","task":"compress it","files":["/tmp/a.mp4"]}'))
      .toEqual({ type: "run_task", task: "compress it", files: ["/tmp/a.mp4"] });
    expect(parseClientEvent('{"type":"run_recipe","name":"compress-video","files":["/tmp/b.mp4"]}'))
      .toEqual({ type: "run_recipe", name: "compress-video", files: ["/tmp/b.mp4"] });
    expect(parseClientEvent('{"type":"confirm_install","run_id":"run-1","confirm":true}'))
      .toEqual({ type: "confirm_install", run_id: "run-1", confirm: true });
    expect(() => parseClientEvent(
      '{"type":"confirm_install","run_id":"run-1","confirm":false}',
    )).toThrow("unsupported WebSocket message shape");
    expect(() => parseClientEvent('{"type":"run_task","task":"x","files":[],"extra":true}'))
      .toThrow("unsupported WebSocket message shape");
    expect(() => parseClientEvent("not json")).toThrow("valid JSON");
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
