import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  executePlan, ExecutionCancelledError, type ExecutionOptions,
} from "./executor.ts";
import type { Plan } from "./plan.ts";
import { probeSystem } from "./probe.ts";

const root = mkdtempSync(join(tmpdir(), "steward-executor-cancel-"));
const base = probeSystem();
afterAll(() => rmSync(root, { recursive: true, force: true }));

function fixture(name: string, body: string) {
  const input = join(root, `${name}.mov`);
  const output = join(root, `${name}.mp4`);
  const pidFile = join(root, `${name}.pid`);
  const marker = join(root, `${name}.started`);
  const binary = join(root, `${name}-ffmpeg`);
  writeFileSync(input, "input");
  writeFileSync(
    binary,
    `#!/bin/sh\necho $$ > '${pidFile}'\ntouch '${marker}'\n${body}\n`,
  );
  chmodSync(binary, 0o700);
  const profile = {
    ...base,
    tools: base.tools.map((tool) => tool.name === "ffmpeg"
      ? { ...tool, installed: true, binary }
      : tool),
  };
  const plan: Plan = {
    name: `cancel-${name}`, tool: "ffmpeg", install_cmd: null,
    commands: [["ffmpeg", "-i", input, output]], output_path: output,
    checks: [{ type: "plays", target: true }],
  };
  return { input, marker, output, pidFile, plan, profile };
}

async function marker(path: string): Promise<void> {
  for (let attempt = 0; attempt < 200 && !existsSync(path); attempt += 1) {
    await Bun.sleep(5);
  }
  expect(existsSync(path)).toBe(true);
}

function assertReaped(pidFile: string): void {
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  expect(() => process.kill(pid, 0)).toThrow();
}

describe("executor cancellation settlement", () => {
  test("rejects an already-aborted signal before spawning", async () => {
    const item = fixture("pre-aborted", "while :; do :; done");
    const controller = new AbortController();
    const cancellation = new ExecutionCancelledError("cancel before spawn");
    controller.abort(cancellation);
    await expect(executePlan(item.plan, item.profile, [item.input], {
      signal: controller.signal,
    })).rejects.toBe(cancellation);
    expect(existsSync(item.marker)).toBe(false);
    expect(existsSync(item.pidFile)).toBe(false);
  });

  test("aborts a running child and settles with the exact cancellation", async () => {
    const item = fixture("running", "while :; do :; done");
    const controller = new AbortController();
    const cancellation = new ExecutionCancelledError("socket disconnected");
    const running = executePlan(item.plan, item.profile, [item.input], {
      signal: controller.signal,
    });
    await marker(item.marker);
    const started = performance.now();
    controller.abort(cancellation);
    await expect(running).rejects.toBe(cancellation);
    expect(performance.now() - started).toBeLessThan(1_000);
    assertReaped(item.pidFile);
  });

  test("cancels stdout and stderr readers whose pipes remain open", async () => {
    const item = fixture(
      "open-pipes",
      "echo stdout-open; echo stderr-open >&2; while :; do :; done",
    );
    const controller = new AbortController();
    const chunks: string[] = [];
    const running = executePlan(item.plan, item.profile, [item.input], {
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === "stdout" || event.type === "stderr") chunks.push(event.chunk);
      },
    });
    await marker(item.marker);
    controller.abort(new ExecutionCancelledError("close open pipes"));
    await expect(running).rejects.toBeInstanceOf(ExecutionCancelledError);
    expect(chunks.join("")).toContain("stdout-open");
    expect(chunks.join("")).toContain("stderr-open");
    assertReaped(item.pidFile);
  });

  test("force-kills a child that ignores graceful termination", async () => {
    const item = fixture(
      "ignore-term",
      "trap '' TERM; echo ignoring; while :; do :; done",
    );
    const controller = new AbortController();
    const running = executePlan(item.plan, item.profile, [item.input], {
      signal: controller.signal,
    });
    await marker(item.marker);
    const started = performance.now();
    controller.abort(new ExecutionCancelledError("force cancellation"));
    await expect(running).rejects.toBeInstanceOf(ExecutionCancelledError);
    expect(performance.now() - started).toBeLessThan(1_000);
    assertReaped(item.pidFile);
  });

  test("settles once when abort races normal exit or is repeated", async () => {
    const item = fixture("exit-race", "echo finishing; exit 0");
    const controller = new AbortController();
    const cancellation = new ExecutionCancelledError("race cancellation");
    let settlements = 0;
    const running = executePlan(item.plan, item.profile, [item.input], {
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === "stdout") controller.abort(cancellation);
      },
    }).then(
      () => { settlements += 1; },
      (error) => {
        settlements += 1;
        expect(error).toBe(cancellation);
      },
    );
    controller.abort(cancellation);
    controller.abort(new ExecutionCancelledError("ignored repeat"));
    await running;
    expect(settlements).toBe(1);
    if (existsSync(item.pidFile)) assertReaped(item.pidFile);
  });

  test("removes the abort listener and leaves no unsettled child", async () => {
    const item = fixture("listener-cleanup", "while :; do :; done");
    const controller = new AbortController();
    const signal = controller.signal;
    const add = signal.addEventListener.bind(signal);
    const remove = signal.removeEventListener.bind(signal);
    let additions = 0;
    let removals = 0;
    signal.addEventListener = ((...args: Parameters<AbortSignal["addEventListener"]>) => {
      additions += 1;
      return add(...args);
    }) as AbortSignal["addEventListener"];
    signal.removeEventListener = ((...args: Parameters<AbortSignal["removeEventListener"]>) => {
      removals += 1;
      return remove(...args);
    }) as AbortSignal["removeEventListener"];
    const options: ExecutionOptions = { signal };
    const running = executePlan(item.plan, item.profile, [item.input], options);
    await marker(item.marker);
    controller.abort(new ExecutionCancelledError("listener cleanup"));
    await expect(running).rejects.toBeInstanceOf(ExecutionCancelledError);
    expect(additions).toBe(1);
    expect(removals).toBe(1);
    assertReaped(item.pidFile);
  });
});
