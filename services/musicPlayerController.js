export function createMusicPlayerController(adapter) {
  let ready = false;
  let setupPromise = null;
  let queueLength = 0;
  let activeIndex = -1;

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

  const syncNextCapability = async () => {
    if (!adapter.setNextEnabled) return;
    await adapter.setNextEnabled(
      queueLength > 0 && activeIndex >= 0 && activeIndex < queueLength - 1
    );
  };

  return {
    ensureReady,
    isReady: () => ready,
    async handleActiveIndexChanged(index) {
      if (!Number.isInteger(index) || index < 0 || index >= queueLength) return;
      activeIndex = index;
      await syncNextCapability();
    },
    async playQueue(items, startIndex) {
      if (!Array.isArray(items) || items.length === 0) {
        throw new Error('Music queue is empty');
      }
      if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= items.length) {
        throw new Error('Music queue start index is invalid');
      }
      await ensureReady();
      await adapter.setQueue(items, startIndex);
      queueLength = items.length;
      activeIndex = startIndex;
      await syncNextCapability();
      await adapter.play();
    },
    togglePlayback: (isPlaying) =>
      runReady(() => (isPlaying ? adapter.pause() : adapter.play())),
    previous: () =>
      runReady(async () => {
        await adapter.previous();
        if (activeIndex > 0) {
          activeIndex -= 1;
          await syncNextCapability();
        }
      }),
    next: () =>
      runReady(async () => {
        if (activeIndex < 0 || activeIndex >= queueLength - 1) return;
        await adapter.next();
        activeIndex += 1;
        await syncNextCapability();
      }),
    seekTo: (seconds) =>
      runReady(() => adapter.seekTo(Math.max(0, Number(seconds) || 0))),
    clear: () =>
      runReady(async () => {
        await adapter.pause();
        await adapter.clear();
        queueLength = 0;
        activeIndex = -1;
        await syncNextCapability();
      }),
  };
}
