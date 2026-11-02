import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamRequest } from './client';

afterEach(() => vi.unstubAllGlobals());
describe('streamed client responses', () => {
  it('handles events split across network chunks', async () => {
    const bytes = new TextEncoder().encode('{"type":"progress","message":"Writing…"}\n{"type":"result","value":{"title":"Done"}}\n');
    const response = new Response(new ReadableStream({ start(controller) {
      for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3)); controller.close();
    } }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    const progress = vi.fn();
    expect(await streamRequest('generate', {}, new AbortController().signal, progress, vi.fn())).toEqual({ title: 'Done' });
    expect(progress).toHaveBeenCalledWith('Writing…');
  });
  it('rejects a stream that ends without a result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"type":"heartbeat"}\n')));
    await expect(streamRequest('generate', {}, new AbortController().signal, vi.fn(), vi.fn())).rejects.toThrow('connection ended');
  });
});
