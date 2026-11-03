import { failure } from './http';

export interface UsageInfo {
  model?: string; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number;
  renderMs?: number; modelMs?: number; firstTokenMs?: number; renderCacheHits?: number;
  thinkingTokens?: number; effort?: string;
  // callUsd: one model call's cost; the response turns these into spentUsd, the running total for the request.
  callUsd?: number; spentUsd?: number;
}
export interface SlideEvent { index: number; html: string; mode: 'full' | 'patch' | 'variant'; pass?: 'polish' }
export interface Operation {
  signal: AbortSignal;
  progress: (message: string) => void;
  usage: (usage: UsageInfo) => void;
  /** A slide finished streaming; the client can show it before the whole deck is done. */
  slide?: (event: SlideEvent) => void;
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
      let spent = 0;
      try {
        const value = await work({ signal: abort.signal,
          progress: message => send({ type: 'progress', message }),
          usage: ({ callUsd, ...usage }) => { if (callUsd) { spent += callUsd; usage.spentUsd = spent; } send({ type: 'usage', usage }); },
          slide: event => send({ type: 'slide', ...event }) });
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
