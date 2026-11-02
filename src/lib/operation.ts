import { failure } from './http';

export interface UsageInfo {
  model?: string; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number;
  renderMs?: number; modelMs?: number; firstTokenMs?: number; renderCacheHits?: number;
  thinkingTokens?: number; effort?: string;
}
export interface Operation {
  signal: AbortSignal;
  progress: (message: string) => void;
  usage: (usage: UsageInfo) => void;
}
/** Newline-delimited events keep long calls observable and cancellable. */
export function operationResponse(request: Request, work: (operation: Operation) => Promise<unknown>): Response {
  const abort = new AbortController();
  const disconnect = () => abort.abort();
  request.signal.addEventListener('abort', disconnect, { once: true });
  if (request.signal.aborted) abort.abort();
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (value: unknown) => {
        if (open && !abort.signal.aborted) {
          try { controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`)); }
          catch { abort.abort(); open = false; }
        }
      };
      const heartbeat = setInterval(() => send({ type: 'heartbeat' }), 15_000);
      try {
        const value = await work({ signal: abort.signal,
          progress: message => send({ type: 'progress', message }),
          usage: usage => send({ type: 'usage', usage }) });
        abort.signal.throwIfAborted();
        send({ type: 'result', value });
      } catch (error) {
        if (!abort.signal.aborted) send({ type: 'error', message: (await failure(error).json()).error });
      } finally {
        clearInterval(heartbeat);
        request.signal.removeEventListener('abort', disconnect);
        if (open) { try { controller.close(); } catch { /* disconnected */ } }
        open = false;
      }
    },
    cancel() { abort.abort(); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
}
