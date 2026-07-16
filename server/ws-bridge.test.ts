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
  test("parses only the two exact client event shapes", () => {
    expect(parseClientEvent('{"type":"run_task","task":"compress it","files":["/tmp/a.mp4"]}'))
      .toEqual({ type: "run_task", task: "compress it", files: ["/tmp/a.mp4"] });
    expect(parseClientEvent('{"type":"run_recipe","name":"compress-video","files":["/tmp/b.mp4"]}'))
      .toEqual({ type: "run_recipe", name: "compress-video", files: ["/tmp/b.mp4"] });
    expect(() => parseClientEvent('{"type":"run_task","task":"x","files":[],"extra":true}'))
      .toThrow("unsupported WebSocket message shape");
    expect(() => parseClientEvent("not json")).toThrow("valid JSON");
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
