import { describe, expect, it, vi, beforeEach } from 'vitest';

const launch = vi.fn();
vi.mock('puppeteer', () => ({ default: { launch: (...a: unknown[]) => launch(...a) } }));

describe('getBrowser', () => {
  beforeEach(() => {
    launch.mockReset();
    vi.resetModules();
  });

  it('reuses one browser across callers', async () => {
    const browser = { connected: true, close: vi.fn() };
    launch.mockResolvedValue(browser);
    const { getBrowser } = await import('./browser');
    const [a, b] = await Promise.all([getBrowser(), getBrowser()]);
    expect(a).toBe(b);
    expect(launch).toHaveBeenCalledTimes(1);
  });

  /**
   * The failure that made a compose hang permanent rather than briefly: the
   * promise is memoised, so one launch that never settles is handed to every
   * later caller, and the whole render path waits on it with no way back short
   * of a restart.
   */
  it('does not cache a launch that failed — the next caller tries again', async () => {
    const good = { connected: true, close: vi.fn() };
    launch.mockRejectedValueOnce(new Error('launch wedged')).mockResolvedValueOnce(good);
    const { getBrowser } = await import('./browser');
    await expect(getBrowser()).rejects.toThrow('launch wedged');
    // The slot was cleared, so this launches rather than joining the corpse.
    await expect(getBrowser()).resolves.toBe(good);
    expect(launch).toHaveBeenCalledTimes(2);
  });

  it('relaunches a browser that disconnected', async () => {
    const dead = { connected: false, close: vi.fn() };
    const fresh = { connected: true, close: vi.fn() };
    launch.mockResolvedValueOnce(dead).mockResolvedValueOnce(fresh);
    const { getBrowser } = await import('./browser');
    await expect(getBrowser()).resolves.toBe(fresh);
    expect(launch).toHaveBeenCalledTimes(2);
  });
});
