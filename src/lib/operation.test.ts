import { describe, expect, it } from 'vitest';
import { operationResponse } from './operation';
import { RequestError } from './http';

describe('observable operations', () => {
  it('streams phases and usage before the final result', async () => {
    const response = operationResponse(new Request('http://localhost:3000'), async operation => {
      operation.progress('Rendering slide 2');
      operation.usage({ model: 'test', inputTokens: 100, outputTokens: 30, cacheReadTokens: 50, cacheWriteTokens: 0 });
      return { title: 'Result' };
    });
    const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
    expect(events.map(e => e.type)).toEqual(['progress', 'usage', 'result']);
    expect(events[2].value.title).toBe('Result');
  });
  it('reports an actionable failure without fabricating a result', async () => {
    const response = operationResponse(new Request('http://localhost:3000'), async () => { throw new RequestError('The model is unavailable.', 502); });
    expect(JSON.parse((await response.text()).trim())).toEqual({ type: 'error', message: 'The model is unavailable.' });
  });
  it('aborts server work when the response reader is cancelled', async () => {
    let observedAbort!: () => void;
    const aborted = new Promise<void>(resolve => { observedAbort = resolve; });
    const response = operationResponse(new Request('http://localhost:3000'), operation => new Promise((_, reject) => {
      operation.signal.addEventListener('abort', () => { observedAbort(); reject(new Error('Stopped')); });
      operation.progress('Designing');
    }));
    const reader = response.body!.getReader();
    await reader.read(); await reader.cancel(); await aborted;
    expect((await reader.read()).done).toBe(true);
  });
});
