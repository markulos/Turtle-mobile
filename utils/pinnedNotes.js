/**
 * pinnedNotes — the notes you want at the top of the Notes tab, remembered.
 *
 * The same shape as `utils/avatarChoice`, for the same reasons: a SYNCHRONOUS
 * in-memory value so render paths never await, hydrated once from AsyncStorage
 * at import, with subscribers so a pin takes effect on every surface at once.
 *
 * ─── Why it is stored in two places ────────────────────────────────────────
 *
 * AsyncStorage is what makes it instant. Pins read only from the pond would
 * mean every cold start paints the timeline in date order and then reshuffles
 * a round trip later — the list jumping under your thumb as you reach for it.
 *
 * `users.settings.pinnedNotes` on the pond is what makes them YOURS rather
 * than this phone's: re-install, or open the app on another device, and the
 * same notes are on top. It needs no server change — PATCH /api/me/settings
 * shallow-merges whatever keys it is given (services/userSettings.js) and GET
 * /api/me returns the whole blob, so this is a new tenant of a store that
 * already exists. The web app can read the same key when it grows the feature.
 *
 * Local wins on a conflict, because local is the only copy that can be newer:
 * it is written first and the pond is written behind it.
 *
 * ─── The order pinned notes keep ──────────────────────────────────────────
 *
 * They are lifted to the top and otherwise keep the order the list already had
 * them in — newest first, or the to-do inbox's own order. A pin says "I want
 * to see this", not "I want to hand-sort my notes", and a stable partition
 * means pinning a second note never moves the first one.
 *
 * ─── Why nothing is ever pruned ───────────────────────────────────────────
 *
 * The notes list is PAGED (200 at a time). An id that matches nothing loaded
 * is not a note that is gone — it is one further down the library, and
 * dropping it would silently unpin notes for anyone with more than a page of
 * them. Pins leave only by being unpinned, or with the note when it is
 * deleted (NotesScreen calls unpinNote there).
 */
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'notes:pinned';
/** The key inside `users.settings`. Shared with the pond — do not rename. */
export const SETTINGS_KEY = 'pinnedNotes';

let pinned = [];
/** Has this DEVICE ever recorded pins? Distinguishes "none" from "unknown",
 *  which is what lets the pond's copy fill a gap without overwriting a real
 *  "I unpinned everything". */
let known = false;
let hydrated = false;
const listeners = new Set();

const announce = () => {
  listeners.forEach((l) => { try { l(); } catch { /* listener's problem */ } });
};

/** Ids, as a clean list: strings only, trimmed, no blanks, no duplicates. */
export function normalizePinnedIds(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const v of raw) {
    if (typeof v !== 'string' && typeof v !== 'number') continue;
    const id = String(v).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

const persistLocal = (value) => {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(value)).catch(() => {
    /* the in-memory value still holds for this session */
  });
};

/** Hydrate once at module load. Until it lands, nothing is pinned. */
AsyncStorage.getItem(STORAGE_KEY)
  .then((raw) => {
    hydrated = true;
    if (!raw) return;
    try {
      const list = normalizePinnedIds(JSON.parse(raw));
      pinned = list;
      known = true;
      announce();
    } catch { /* unreadable — nothing is pinned, and the next pin rewrites it */ }
  })
  .catch(() => { hydrated = true; });

/** The pinned ids, newest pin first. */
export function pinnedNoteIds() {
  return pinned;
}

/** Has the stored value been read yet? Lets a caller avoid a first-frame flip. */
export function pinnedNotesReady() {
  return hydrated;
}

/** Has this device ever recorded pins of its own? False on a fresh install,
 *  which is the only case the pond's copy is allowed to fill. */
export function pinnedNotesKnown() {
  return known;
}

export function isNotePinned(id) {
  return !!id && pinned.includes(String(id));
}

/** The list with `id` pinned, or unpinned if it already was. Newest pin leads,
 *  which only matters to this list — the timeline keeps its own order. */
export function togglePinnedIds(ids, id) {
  const key = String(id);
  const list = normalizePinnedIds(ids);
  return list.includes(key) ? list.filter((x) => x !== key) : [key, ...list];
}

const commit = async (next, api) => {
  pinned = next;
  known = true;
  hydrated = true;
  announce();
  persistLocal(next);
  if (api?.patch) {
    // The WHOLE array: PATCH /me/settings merges at the top level, so a
    // partial list here would be the new list, not a patch of it.
    try { await api.patch('/me/settings', { [SETTINGS_KEY]: next }); }
    catch { /* the pond catches up the next time a pin is saved */ }
  }
};

/**
 * Pin a note, or unpin it if it is already pinned. Returns the new list.
 *
 * Local first and synchronously, so the list has already moved when this
 * returns; the pond is told behind it. `api` is optional: without it (or with
 * the pond unreachable) the pin still holds on this device, the same trade
 * every other preference in the app makes.
 */
export async function toggleNotePin(id, api) {
  if (!id) return pinned;
  const next = togglePinnedIds(pinned, id);
  await commit(next, api);
  return next;
}

/** Drop a pin without toggling it on — for a note that has been deleted. */
export async function unpinNote(id, api) {
  if (!id || !pinned.includes(String(id))) return pinned;
  const next = pinned.filter((x) => x !== String(id));
  await commit(next, api);
  return next;
}

/**
 * Adopt the pond's pins — called with `settings` from GET /api/me.
 *
 * Only fills a GAP: a device that has never recorded pins of its own (a fresh
 * install, or a second phone). It must not overwrite this device's list, or
 * an unpin made seconds ago would come back while the pond's own write was
 * still in flight.
 */
export function adoptServerPinnedNotes(settings) {
  if (known) return;
  const raw = settings && typeof settings === 'object' ? settings[SETTINGS_KEY] : null;
  const list = normalizePinnedIds(raw);
  if (list.length === 0) return;
  pinned = list;
  known = true;
  hydrated = true;
  persistLocal(list);
  announce();
}

/** Subscribe to changes. Returns the unsubscribe. */
export function subscribePinnedNotes(listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Reset everything. For tests — nothing in the app calls this. */
export function __resetPinnedNotes() {
  pinned = [];
  known = false;
  hydrated = false;
  listeners.clear();
}

/**
 * The pinned notes of `list`, first, in the order the list already had them —
 * then everything else, untouched. A stable partition, so pinning one note
 * never reorders another.
 */
export function sortPinnedFirst(list, ids) {
  if (!Array.isArray(list) || list.length === 0) return list;
  const set = ids instanceof Set ? ids : new Set(normalizePinnedIds(ids));
  if (set.size === 0) return list;
  const top = [];
  const rest = [];
  for (const item of list) {
    if (item && set.has(String(item.id))) top.push(item);
    else rest.push(item);
  }
  // Nothing on this list is pinned: hand back the SAME array, so a memoized
  // list does not re-render for a partition that changed nothing.
  if (top.length === 0) return list;
  return top.concat(rest);
}

/** The pinned ids, re-rendering the caller when they change. */
export function usePinnedNoteIds() {
  const [value, setValue] = useState(pinned);
  useEffect(() => {
    // Read once on mount as well as on change: the AsyncStorage hydration may
    // have landed between this component's render and its effect.
    setValue(pinnedNoteIds());
    return subscribePinnedNotes(() => setValue(pinnedNoteIds()));
  }, []);
  return value;
}

export default usePinnedNoteIds;
