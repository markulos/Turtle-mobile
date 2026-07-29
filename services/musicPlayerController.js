export function createMusicPlayerController(adapter) {
  let ready = false;
  let setupPromise = null;

  const ensureReady = async () => {
    if (ready) return;
    if (!setupPromise) {
      setupPromise = Promise.resolve(adapter.setup())
        .then(() => {
          ready = true;
        })
        .catch((error) => {
          setupPromise = null;
          throw error;
        });
    }
    return setupPromise;
  };

  const runReady = async (operation) => {
    await ensureReady();
    return operation();
  };

  return {
    ensureReady,
    isReady: () => ready,
    async playQueue(items, startIndex) {
      if (!Array.isArray(items) || items.length === 0) {
        throw new Error('Music queue is empty');
      }
      if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= items.length) {
        throw new Error('Music queue start index is invalid');
      }
      await ensureReady();
      await adapter.setQueue(items, startIndex);
      await adapter.play();
    },
    togglePlayback: (isPlaying) =>
      runReady(() => (isPlaying ? adapter.pause() : adapter.play())),
    previous: () => runReady(() => adapter.previous()),
    next: () => runReady(() => adapter.next()),
    seekTo: (seconds) =>
      runReady(() => adapter.seekTo(Math.max(0, Number(seconds) || 0))),
    clear: () =>
      runReady(async () => {
        await adapter.pause();
        await adapter.clear();
      }),
  };
}
