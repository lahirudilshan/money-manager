import { beforeEach, describe, expect, it, vi } from 'vitest';

const appState = { currentState: 'active' };
vi.mock('react-native', () => ({ AppState: appState }));

const job = { kept: false, update: vi.fn(), finish: vi.fn() };
vi.mock('../backgroundWork', () => ({ startBackgroundJob: vi.fn(() => job) }));

const notifyWorkDone = vi.fn().mockResolvedValue(undefined);
vi.mock('../notifications', () => ({ notifyWorkDone }));

const { estimatedFraction, withLiveWork } = await import('../liveWork');

const options = {
  title: 'Reading your bill',
  subtitle: 'Venue',
  expectedSeconds: 20,
  done: (r: { ok: boolean }) => (r.ok ? { title: 'Bill read', body: 'Check it' } : null),
  failed: { title: 'Could not read', body: 'Try again' },
};

describe('estimatedFraction', () => {
  it('rises with time and never reaches the end on its own', () => {
    expect(estimatedFraction(0, 20)).toBe(0);
    expect(estimatedFraction(20, 20)).toBeGreaterThan(0.6);
    expect(estimatedFraction(600, 20)).toBe(0.95);
  });
});

describe('withLiveWork', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appState.currentState = 'active';
  });

  it('says nothing when the user is still looking at the screen', async () => {
    await expect(withLiveWork(options, async () => ({ ok: true }))).resolves.toEqual({ ok: true });
    expect(job.finish).toHaveBeenCalledWith(true);
    expect(notifyWorkDone).not.toHaveBeenCalled();
  });

  it('notifies when it finishes while the app is in the background', async () => {
    await withLiveWork(options, async () => {
      appState.currentState = 'background';
      return { ok: true };
    });
    expect(notifyWorkDone).toHaveBeenCalledWith({ title: 'Bill read', body: 'Check it' });
  });

  it('closes the Live Activity as failed and announces a throw', async () => {
    await expect(
      withLiveWork(options, async () => {
        appState.currentState = 'background';
        throw new Error('network');
      }),
    ).rejects.toThrow('network');
    expect(job.finish).toHaveBeenCalledWith(false);
    expect(notifyWorkDone).toHaveBeenCalledWith(options.failed);
  });
});
