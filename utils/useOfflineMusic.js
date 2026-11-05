/**
 * React's view of the offline music store.
 *
 * Thin on purpose: the behaviour is in services/musicOfflineStore, which
 * knows nothing about React and so keeps downloading when the Music vault
 * unmounts. This only subscribes to it and resolves the absolute URL to
 * fetch, which is the one thing the store cannot work out for itself —
 * the pond's address lives in ServerContext.
 */
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useServer } from '../context/ServerContext';
import { musicOfflineStore } from '../services/musicOfflineStore';
import { resolveMediaUrl } from '../services/musicTrackMapper';

export function useOfflineMusic(store = musicOfflineStore) {
  const { getBaseUrl, getMediaBaseUrl } = useServer();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);

  // Same base the player builds its stream URLs from, so a track downloads
  // from exactly the address it would otherwise have streamed from.
  const mediaBase = useMemo(
    () => (getMediaBaseUrl ? getMediaBaseUrl() : getBaseUrl()).replace(/\/api$/, ''),
    [getBaseUrl, getMediaBaseUrl]
  );

  const download = useCallback(
    (row) => store.download(row?.id, resolveMediaUrl(row?.rawUrl || row?.url, mediaBase)),
    [mediaBase, store]
  );

  /**
   * A whole playlist, one at a time. Serial, not parallel: a dozen
   * concurrent multi-megabyte downloads on a phone connection starve the
   * track that is currently playing, which is the thing the person is
   * actually listening to.
   */
  const downloadMany = useCallback(
    async (rows) => {
      for (const row of rows || []) {
        if (store.isDownloaded(row?.id)) continue;
        await store.download(row?.id, resolveMediaUrl(row?.rawUrl || row?.url, mediaBase));
      }
    },
    [mediaBase, store]
  );

  const removeMany = useCallback(
    async (rows) => {
      for (const row of rows || []) await store.remove(row?.id);
    },
    [store]
  );

  return useMemo(
    () => ({
      ...snapshot,
      statusOf: (id) => store.statusOf(id),
      isDownloaded: (id) => store.isDownloaded(id),
      localUris: () => store.localUris(),
      download,
      downloadMany,
      remove: (id) => store.remove(id),
      removeMany,
      cancel: (id) => store.cancel(id),
      clear: () => store.clear(),
    }),
    [snapshot, download, downloadMany, removeMany, store]
  );
}
