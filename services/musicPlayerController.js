export function createMusicPlayerController(adapter) {
  let ready = false;
  let setupPromise = null;
  let queueLength = 0;
  let activeIndex = -1;
  /**
   * The media ids in the queue, in order — the only thing that can answer
   * "where in the queue is this track?" after the fact.
   *
   * Kept because the lock screen outlives the list: renaming a track that is
   * PLAYING has to move the name on the lock screen too, and the player
   * addresses its items by index, not by id.
   */
  let queueIds = [];

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
      queueIds = items.map((item) => String(item?.mediaId));
      activeIndex = startIndex;
      await syncNextCapability();
      await adapter.play();
    },
    /**
     * A track got a new name — carry it to the lock screen.
     *
     * The queue is handed to the player ONCE, when playback starts, and
     * nothing rebuilds it afterwards: renaming a track updated every list in
     * the app and left the lock screen, Control Centre and the car showing
     * the name the track had when you pressed play. This is the only path
     * that fixes that without interrupting playback (the player's own
     * updateMetadata is built for exactly this).
     *
     * A no-op when the track is not in the current queue, which is the common
     * case — you usually rename something you are not listening to.
     */
    async renameInQueue(mediaId, title) {
      if (!adapter.updateMetadata || !mediaId || !title) return false;
      const index = queueIds.indexOf(String(mediaId));
      if (index < 0) return false;
      await runReady(() => adapter.updateMetadata(index, { title }));
      return true;
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
