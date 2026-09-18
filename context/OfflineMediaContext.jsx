/**
 * OfflineMediaContext — which pictures are kept on the phone, app-wide.
 *
 * Two consumers, and they are why this is a context rather than props:
 *   • the viewer's chrome draws the Save button's state, and
 *   • `ViewerPage`'s PhotoBody picks the LOCAL file over the server url,
 * and those two sit at opposite ends of the viewer tree with a memoised
 * gesture stage in between. Threading a prop through would re-key the pages.
 *
 * Re-render cost: the value changes only when a save or a remove COMPLETES —
 * a committed user action, never a gesture frame — which is the same bar the
 * viewer holds everything else to.
 *
 * Used with no provider it reports `enabled: false`, which is what the viewer
 * hangs the Save button on — a button that is present but can never save is
 * worse than no button, so the feature is genuinely ABSENT outside the
 * provider rather than merely inert.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import {
  clearAllOffline, loadIndex, reconcile, removeMedia, saveMedia, writeIndex,
  savedCount, totalBytes, uriForName, withEntry, withoutId,
} from '../services/offlineMedia';

const EMPTY = {};

const OfflineMediaContext = createContext({
  enabled: false,
  saved: EMPTY,
  ready: false,
  isSaved: () => false,
  isBusy: () => false,
  uriFor: () => null,
  save: async () => false,
  remove: async () => false,
  clearAll: async () => {},
  refresh: async () => {},
  bytes: 0,
  count: 0,
});

export const useOfflineMedia = () => useContext(OfflineMediaContext);

export function OfflineMediaProvider({ children }) {
  const [saved, setSaved] = useState(EMPTY);
  const [busy, setBusy] = useState(EMPTY);
  const [ready, setReady] = useState(false);
  // Actions read the live index without being re-created when it changes —
  // a changing `save` identity would invalidate the viewer's callbacks.
  const savedRef = useRef(saved);
  savedRef.current = saved;

  const refresh = useCallback(async () => {
    const index = await reconcile(await loadIndex());
    setSaved(index);
    setReady(true);
    return index;
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const markBusy = useCallback((id, value) => {
    setBusy((prev) => {
      if (!value) {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return prev[id] ? prev : { ...prev, [id]: true };
    });
  }, []);

  /**
   * Keep this picture. `url` is absolute and comes from the caller, because
   * only the gallery knows which origin (and which tier) the phone should be
   * pulling from. Resolves true/false; it never throws at the button.
   */
  const save = useCallback(async (item, url) => {
    const id = item?.id;
    if (!id || !url) return false;
    if (savedRef.current[id]) return true;
    markBusy(id, true);
    try {
      const entry = await saveMedia({ id, url, filename: item.filename, type: item.type || 'image' });
      const next = withEntry(savedRef.current, entry);
      savedRef.current = next;
      setSaved(next);
      await writeIndex(next);
      return true;
    } catch (e) {
      console.warn('[offline] save failed:', e?.message || e);
      return false;
    } finally {
      markBusy(id, false);
    }
  }, [markBusy]);

  const remove = useCallback(async (id) => {
    const entry = savedRef.current[id];
    if (!entry) return false;
    markBusy(id, true);
    try {
      await removeMedia(entry);
      const next = withoutId(savedRef.current, id);
      savedRef.current = next;
      setSaved(next);
      await writeIndex(next);
      return true;
    } finally {
      markBusy(id, false);
    }
  }, [markBusy]);

  const clearAll = useCallback(async () => {
    await clearAllOffline();
    savedRef.current = EMPTY;
    setSaved(EMPTY);
  }, []);

  const isSaved = useCallback((id) => !!(id && saved[id]), [saved]);
  const isBusy = useCallback((id) => !!(id && busy[id]), [busy]);
  const uriFor = useCallback((id) => {
    const entry = id ? saved[id] : null;
    return entry ? uriForName(entry.name) : null;
  }, [saved]);

  const value = useMemo(() => ({
    enabled: true,
    saved,
    ready,
    isSaved,
    isBusy,
    uriFor,
    save,
    remove,
    clearAll,
    refresh,
    bytes: totalBytes(saved),
    count: savedCount(saved),
  }), [saved, ready, isSaved, isBusy, uriFor, save, remove, clearAll, refresh]);

  return <OfflineMediaContext.Provider value={value}>{children}</OfflineMediaContext.Provider>;
}

export default OfflineMediaContext;
