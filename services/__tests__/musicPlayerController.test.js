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
    setNextEnabled: jest.fn().mockResolvedValue(undefined),
    updateMetadata: jest.fn().mockResolvedValue(undefined),
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
    await controller.playQueue([{ mediaId: 'one' }, { mediaId: 'two' }], 0);
    adapter.play.mockClear();

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

  test('disables native Next for an initial final item and makes Next harmless', async () => {
    const adapter = makeAdapter();
    const controller = createMusicPlayerController(adapter);

    await controller.playQueue([{ mediaId: 'only' }], 0);
    await controller.next();

    expect(adapter.setNextEnabled).toHaveBeenLastCalledWith(false);
    expect(adapter.next).not.toHaveBeenCalled();
  });

  test('disables Next after automatic advance reaches the final item', async () => {
    const adapter = makeAdapter();
    const controller = createMusicPlayerController(adapter);
    await controller.playQueue([{ mediaId: 'one' }, { mediaId: 'two' }], 0);

    await controller.handleActiveIndexChanged(1);

    expect(adapter.setNextEnabled).toHaveBeenLastCalledWith(false);
  });

  test('re-enables Next after moving previous from the final item', async () => {
    const adapter = makeAdapter();
    const controller = createMusicPlayerController(adapter);
    await controller.playQueue([{ mediaId: 'one' }, { mediaId: 'two' }], 1);

    await controller.previous();

    expect(adapter.previous).toHaveBeenCalledTimes(1);
    expect(adapter.setNextEnabled).toHaveBeenLastCalledWith(true);
  });

  test('recomputes native Next when the queue is replaced', async () => {
    const adapter = makeAdapter();
    const controller = createMusicPlayerController(adapter);

    await controller.playQueue([{ mediaId: 'only' }], 0);
    await controller.playQueue([{ mediaId: 'one' }, { mediaId: 'two' }], 0);

    expect(adapter.setNextEnabled.mock.calls.map(([enabled]) => enabled)).toEqual([false, true]);
  });
});

test('exposes the complete controller contract', () => {
  const controller = createMusicPlayerController(makeAdapter());
  expect(Object.keys(controller).sort()).toEqual(
    [
      'clear',
      'ensureReady',
      'handleActiveIndexChanged',
      'isReady',
      'next',
      'playQueue',
      'previous',
      'renameInQueue',
      'seekTo',
      'togglePlayback',
    ].sort()
  );
});

describe('renaming a track that is PLAYING', () => {
  // The queue is handed to the player once, when playback starts, and nothing
  // rebuilds it afterwards — so a rename updated every list in the app and
  // left the lock screen, Control Centre and the car showing the name the
  // track had when you pressed play.
  const QUEUE = [
    { mediaId: 'a', url: 'http://p/a.m4a', title: 'First' },
    { mediaId: 'b', url: 'http://p/b.m4a', title: 'Second' },
  ];

  test('moves the name on the lock screen, by index, without touching playback', async () => {
    const adapter = makeAdapter();
    const controller = createMusicPlayerController(adapter);
    await controller.playQueue(QUEUE, 0);
    adapter.play.mockClear();
    adapter.setQueue.mockClear();

    await expect(controller.renameInQueue('b', 'Second, renamed')).resolves.toBe(true);

    expect(adapter.updateMetadata).toHaveBeenCalledWith(1, { title: 'Second, renamed' });
    // Not a rebuild and not a restart: the point of updateMetadata is that the
    // audio keeps playing through it.
    expect(adapter.setQueue).not.toHaveBeenCalled();
    expect(adapter.play).not.toHaveBeenCalled();
  });

  test('a track that is not in the queue is a no-op, not an error', async () => {
    // The common case: you usually rename something you are not listening to.
    const adapter = makeAdapter();
    const controller = createMusicPlayerController(adapter);
    await controller.playQueue(QUEUE, 0);

    await expect(controller.renameInQueue('not-queued', 'Whatever')).resolves.toBe(false);
    expect(adapter.updateMetadata).not.toHaveBeenCalled();
  });

  test('ignores an empty name rather than blanking the lock screen', async () => {
    const adapter = makeAdapter();
    const controller = createMusicPlayerController(adapter);
    await controller.playQueue(QUEUE, 0);

    await expect(controller.renameInQueue('a', '')).resolves.toBe(false);
    await expect(controller.renameInQueue('', 'Name')).resolves.toBe(false);
    expect(adapter.updateMetadata).not.toHaveBeenCalled();
  });

  test('degrades on a player that cannot update metadata', async () => {
    const adapter = makeAdapter({ updateMetadata: undefined });
    const controller = createMusicPlayerController(adapter);
    await controller.playQueue(QUEUE, 0);

    await expect(controller.renameInQueue('a', 'Renamed')).resolves.toBe(false);
  });

  test('follows the queue it was last given', async () => {
    // Play something else and the indices move; the rename has to find the
    // track in the CURRENT queue or write the wrong row's name.
    const adapter = makeAdapter();
    const controller = createMusicPlayerController(adapter);
    await controller.playQueue(QUEUE, 0);
    await controller.playQueue([{ mediaId: 'z' }, { mediaId: 'b' }, { mediaId: 'a' }], 0);

    await controller.renameInQueue('a', 'Moved');
    expect(adapter.updateMetadata).toHaveBeenCalledWith(2, { title: 'Moved' });
  });
});
