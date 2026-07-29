import { createMusicPlayerController } from '../musicPlayerController';

function makeAdapter(overrides = {}) {
  return {
    setup: jest.fn().mockResolvedValue(undefined),
    setQueue: jest.fn().mockResolvedValue(undefined),
    play: jest.fn().mockResolvedValue(undefined),
    pause: jest.fn().mockResolvedValue(undefined),
    previous: jest.fn().mockResolvedValue(undefined),
    next: jest.fn().mockResolvedValue(undefined),
    seekTo: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('musicPlayerController', () => {
  test('deduplicates concurrent native setup', async () => {
    const adapter = makeAdapter();
    const controller = createMusicPlayerController(adapter);

    await Promise.all([controller.ensureReady(), controller.ensureReady()]);

    expect(adapter.setup).toHaveBeenCalledTimes(1);
    expect(controller.isReady()).toBe(true);
  });

  test('allows setup to retry after a setup failure', async () => {
    const adapter = makeAdapter({
      setup: jest
        .fn()
        .mockRejectedValueOnce(new Error('native unavailable'))
        .mockResolvedValueOnce(undefined),
    });
    const controller = createMusicPlayerController(adapter);

    await expect(controller.ensureReady()).rejects.toThrow('native unavailable');
    await expect(controller.ensureReady()).resolves.toBeUndefined();
    expect(adapter.setup).toHaveBeenCalledTimes(2);
  });

  test('sets a validated queue at the selected index before playing', async () => {
    const adapter = makeAdapter();
    const controller = createMusicPlayerController(adapter);
    const items = [{ mediaId: 'a', url: 'https://example/a.mp3' }];

    await controller.playQueue(items, 0);

    expect(adapter.setQueue).toHaveBeenCalledWith(items, 0);
    expect(adapter.play).toHaveBeenCalledTimes(1);
    expect(adapter.setQueue.mock.invocationCallOrder[0]).toBeLessThan(
      adapter.play.mock.invocationCallOrder[0]
    );
  });

  test('rejects an invalid queue before touching the active native queue', async () => {
    const adapter = makeAdapter();
    const controller = createMusicPlayerController(adapter);

    await expect(controller.playQueue([], 0)).rejects.toThrow('Music queue is empty');
    expect(adapter.setQueue).not.toHaveBeenCalled();
  });

  test('routes transport, seek, and clear commands through the adapter', async () => {
    const adapter = makeAdapter();
    const controller = createMusicPlayerController(adapter);
    await controller.ensureReady();

    await controller.togglePlayback(true);
    await controller.togglePlayback(false);
    await controller.previous();
    await controller.next();
    await controller.seekTo(12.5);
    await controller.clear();

    expect(adapter.pause).toHaveBeenCalledTimes(2);
    expect(adapter.play).toHaveBeenCalledTimes(1);
    expect(adapter.previous).toHaveBeenCalledTimes(1);
    expect(adapter.next).toHaveBeenCalledTimes(1);
    expect(adapter.seekTo).toHaveBeenCalledWith(12.5);
    expect(adapter.clear).toHaveBeenCalledTimes(1);
  });
});

test('exposes the complete controller contract', () => {
  const controller = createMusicPlayerController(makeAdapter());
  expect(Object.keys(controller).sort()).toEqual(
    [
      'clear',
      'ensureReady',
      'isReady',
      'next',
      'playQueue',
      'previous',
      'seekTo',
      'togglePlayback',
    ].sort()
  );
});
