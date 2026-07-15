import type { ExecutionEvent } from "./execution-types.ts";

const MAX_CAPTURE_CHARS = 64 * 1_024;

function appendTail(current: string, chunk: string): string {
  return `${current}${chunk}`.slice(-MAX_CAPTURE_CHARS);
}

export async function consumeProcessStream(
  stream: ReadableStream<Uint8Array>,
  type: "stdout" | "stderr",
  emit: (event: ExecutionEvent) => void,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let tail = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    tail = appendTail(tail, chunk);
    emit({ type, chunk });
  }
  const final = decoder.decode();
  if (final) {
    tail = appendTail(tail, final);
    emit({ type, chunk: final });
  }
  return tail;
}
