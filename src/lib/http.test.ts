import { describe, expect, it } from 'vitest';
import { body, checkOrigin } from './http';
import { emptyWorkspace, workspaceSchema } from './schema';

describe('local browser requests', () => {
  it('accepts the original Host when Next normalizes request.url', async () => {
    const request = new Request('http://localhost:3000/api/workspace', {
      method: 'PUT', headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', 'content-type': 'application/json' },
      body: JSON.stringify(emptyWorkspace),
    });
    expect(await body(request, workspaceSchema)).toEqual(emptyWorkspace);
  });
  it('rejects cross-origin mutation requests', () => {
    expect(() => checkOrigin(new Request('http://localhost:3000/api/workspace', { headers: { host: 'localhost:3000', origin: 'https://example.com' } }))).toThrow('must come from ContentBuilder');
  });
  it('rejects hostnames outside the local app', () => {
    expect(() => checkOrigin(new Request('http://localhost:3000/api/workspace', { headers: { host: 'example.com', origin: 'http://example.com' } }))).toThrow('localhost');
  });
  it('reports invalid JSON without a server error', async () => {
    const request = new Request('http://localhost:3000/api/workspace', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{broken' });
    await expect(body(request, workspaceSchema)).rejects.toThrow('invalid JSON');
  });
});
