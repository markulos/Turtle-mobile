/**
 * useFolderData — one folder listing, the house way: the cached page paints
 * first, the network replaces it, and every mutation lands on screen before
 * the request leaves (functional updaters, so two quick taps never clobber
 * each other). Requests go through sendOrQueue: offline they park in the
 * outbox and the optimistic state stays; only a permanent failure reverts.
 *
 * The cache key carries a hash of the auth token (like useTaskData) so a
 * different sign-in never sees a previous user's tree.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useServer, getApiAuthToken } from '../../../../context/ServerContext';
import { sendOrQueue } from '../../../../services/offlineQueue';

const PAGE = 200;

const cacheKey = (parent, sort, order) => {
  const token = getApiAuthToken() || 'anon';
  let h = 0;
  for (let i = 0; i < token.length; i++) h = (h * 31 + token.charCodeAt(i)) | 0;
  return `turtle.filesCache.${h >>> 0}.${parent}.${sort}.${order}`;
};

const byName = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' });

// ── pure transforms (exported for tests) ────────────────────────────────────
export const applyRename = (l, id, name) => ({ ...l, folders: l.folders.map((f) => (f.id === id ? { ...f, name } : f)).sort(byName) });
export const withoutFolder = (l, id) => ({ ...l, folders: l.folders.filter((f) => f.id !== id) });
export const withFolder = (l, folder) => ({ ...l, folders: [...l.folders.filter((f) => f.id !== folder.id), { itemCount: 0, folderCount: 0, covers: [], ...folder }].sort(byName) });
export const withoutItems = (l, ids) => {
  const gone = new Set(ids.map(String));
  const items = l.items.filter((i) => !gone.has(String(i.id)));
  const removed = l.items.length - items.length;
  return { ...l, items, pagination: { ...l.pagination, total: Math.max(0, (l.pagination?.total || 0) - removed) } };
};
const bumpCount = (l, folderId, delta) => ({ ...l, folders: l.folders.map((f) => (f.id === folderId ? { ...f, itemCount: Math.max(0, (f.itemCount || 0) + delta) } : f)) });

export default function useFolderData(parent, { sort = 'date', order = 'desc' } = {}) {
  const { api } = useServer();
  const [data, setData] = useState(null);
  // Always-current snapshot of `data`, mirroring screens/TasksScreen/hooks/
  // useTaskData.js's tasksRef: mutation handlers below read this synchronously
  // instead of peeking at state through a setData updater. A peek's updater
  // function may run twice under StrictMode or run late when another update
  // is already pending, so a fast-rejecting request could otherwise capture a
  // stale "before"/snapshot. Assigned during render, every render.
  const dataRef = useRef(null);
  dataRef.current = data;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const key = cacheKey(parent, sort, order);

  const refresh = useCallback(async () => {
    try {
      const r = await api.get(`/folders?parent=${encodeURIComponent(parent)}&sort=${sort}&order=${order}&limit=${PAGE}&offset=0`);
      if (!r || r.success === false) throw new Error(r?.message || r?.error || 'Could not load the folder.');
      const listing = { folder: r.folder || null, path: r.path || [], folders: r.folders || [], items: r.items || [], unfiled: r.unfiled, pagination: r.pagination || { total: (r.items || []).length, limit: PAGE, offset: 0, hasMore: false } };
      if (!alive.current) return;
      setData(listing);
      setError(null);
      AsyncStorage.setItem(key, JSON.stringify({ listing, savedAt: Date.now() })).catch(() => {});
    } catch (e) {
      if (alive.current) setError(e?.message || 'Could not load the folder.');
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [api, parent, sort, order, key]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    AsyncStorage.getItem(key).then((raw) => {
      if (cancelled || !raw) return;
      try { const parsed = JSON.parse(raw); if (parsed?.listing) setData((cur) => cur || parsed.listing); } catch { /* cold */ }
    }).catch(() => {}).finally(() => { if (!cancelled) refresh(); });
    return () => { cancelled = true; };
  }, [key, refresh]);

  /** Apply `next` now, send, and undo with `undo` only on a permanent failure. */
  const optimistic = useCallback(async (next, request, undo) => {
    setData((cur) => (cur ? next(cur) : cur));
    try {
      const r = await sendOrQueue(api, request);
      if (!r.queued && r.result && r.result.success === false) throw new Error(r.result.message || r.result.error || 'Request failed');
      return r;
    } catch (e) {
      setData((cur) => (cur && undo ? undo(cur) : cur));
      throw e;
    }
  }, [api]);

  const createFolder = useCallback(async (name) => {
    const tempId = `tmp_${Date.now()}`;
    const parentId = parent === 'root' || parent === 'unfiled' ? null : parent;
    const r = await optimistic(
      (l) => withFolder(l, { id: tempId, name, parentId, pending: true }),
      { method: 'post', path: '/folders', body: { parentId, name }, label: `New folder “${name}”` },
      (l) => withoutFolder(l, tempId),
    );
    const real = r.result?.folder;
    if (real) setData((l) => (l ? withFolder(withoutFolder(l, tempId), real) : l));
    return { queued: r.queued, folder: real || null };
  }, [optimistic, parent]);

  const renameFolder = useCallback((id, name) => {
    const before = dataRef.current?.folders.find((f) => f.id === id)?.name ?? name;
    return optimistic(
      (l) => applyRename(l, id, name),
      { method: 'patch', path: `/folders/${id}`, body: { name }, key: `folder:rename:${id}`, label: `Rename “${name}”` },
      (l) => applyRename(l, id, before),
    );
  }, [optimistic]);

  const moveFolder = useCallback((id, parentId) => {
    const snapshot = dataRef.current?.folders.find((f) => f.id === id) ?? null;
    const target = parentId === 'root' || parentId === 'unfiled' ? null : parentId;
    return optimistic(
      (l) => withoutFolder(l, id),
      { method: 'patch', path: `/folders/${id}`, body: { parentId: target }, key: `folder:move:${id}`, label: 'Move folder' },
      (l) => (snapshot ? withFolder(l, snapshot) : l),
    );
  }, [optimistic]);

  const deleteFolder = useCallback((id, moveTo = null) => {
    const snapshot = dataRef.current?.folders.find((f) => f.id === id) ?? null;
    const q = moveTo ? `?moveTo=${encodeURIComponent(moveTo)}` : '';
    return optimistic(
      (l) => withoutFolder(l, id),
      { method: 'delete', path: `/folders/${id}${q}`, key: `folder:delete:${id}`, label: 'Delete folder' },
      (l) => (snapshot ? withFolder(l, snapshot) : l),
    );
  }, [optimistic]);

  const moveItems = useCallback((ids, folderId) => {
    const snapshot = dataRef.current;
    const target = folderId || null;
    return optimistic(
      (l) => bumpCount(withoutItems(l, ids), target, ids.length),
      { method: 'post', path: '/media/move', body: { ids, folderId: target }, key: `media:move:${ids.slice().sort().join(',').slice(0, 200)}`, label: `Move ${ids.length} item${ids.length === 1 ? '' : 's'}` },
      (l) => snapshot || l,
    );
  }, [optimistic]);

  const removeItems = useCallback(async (ids) => {
    // Snapshot from the ref mirror, synchronously — same reason as the other
    // mutations above: a setData((l) => { snapshot = l; ... }) peek can still
    // be sitting unflushed when a fast-rejecting request needs it (proven by
    // this hook's own tests), so a permanent failure would silently skip both
    // the error and the restore below.
    const snapshot = dataRef.current;
    setData((l) => (l ? withoutItems(l, ids) : l));
    const failed = [];
    const results = [];
    for (let i = 0; i < ids.length; i += 6) {
      await Promise.all(ids.slice(i, i + 6).map(async (id) => {
        try { results.push(await sendOrQueue(api, { method: 'delete', path: `/media/${id}`, key: `media:delete:${id}`, label: 'Delete' })); }
        catch (e) { failed.push({ id, message: e?.message || 'Delete failed' }); }
      }));
    }
    if (failed.length && snapshot) {
      const keep = new Set(failed.map((f) => String(f.id)));
      setData((l) => (l ? { ...l, items: [...l.items, ...snapshot.items.filter((it) => keep.has(String(it.id)))] } : l));
      throw new Error(`${failed.length} item${failed.length === 1 ? '' : 's'} could not be deleted. ${failed[0].message}`);
    }
    return { queued: results.some((r) => r?.queued) };
  }, [api]);

  return { data, loading, error, refresh, createFolder, renameFolder, moveFolder, deleteFolder, moveItems, removeItems };
}
