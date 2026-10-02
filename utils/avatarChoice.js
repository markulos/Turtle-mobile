/**
 * avatarChoice — "which animal am I", remembered.
 *
 * The same shape as `utils/debugSettings`: a SYNCHRONOUS in-memory value so
 * render paths never await, hydrated once from AsyncStorage at import, with
 * subscribers so a pick takes effect live on every surface at once instead of
 * at the next launch.
 *
 * ─── Why it is stored in two places ────────────────────────────────────────
 *
 * AsyncStorage is what makes it instant. A choice read only from the pond
 * would mean every cold start paints the hashed default and then flips to the
 * chosen animal a round trip later — a visible flicker on the first screen of
 * the app, every time.
 *
 * `users.settings.avatarAnimal` on the pond is what makes it THEIRS rather
 * than this phone's. Re-install, or sign in on another device, and the animal
 * comes back. It needs no server change: PATCH /api/me/settings shallow-merges
 * whatever keys it is given (services/userSettings.js) and GET /api/me returns
 * the whole blob, so the key is simply a new tenant of an existing store.
 *
 * Local wins on a conflict, because local is the only copy that can be newer:
 * it is written first and the pond is written behind it.
 *
 * ─── What this does NOT do ─────────────────────────────────────────────────
 *
 * Other members of the pond still see the animal your id HASHES to, not the
 * one you picked. `GET /api/friends` returns id/name/avatarUrl and no
 * settings, so there is nothing for their copy of the app to read. Serving it
 * is a server change (one field on that payload plus the message/board
 * rows that carry a person) and this file is deliberately ready for it: the
 * value is already on the pond, under a documented key.
 */
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isAvatarChoice } from './avatar';

const STORAGE_KEY = 'profile:avatarAnimal';
/** The key inside `users.settings`. Shared with the pond — do not rename. */
export const SETTINGS_KEY = 'avatarAnimal';

// null = no choice made; the hashed default applies.
let chosen = null;
let hydrated = false;
const listeners = new Set();

const announce = () => {
  listeners.forEach((l) => { try { l(); } catch { /* listener's problem */ } });
};

/** Hydrate once at module load. Until it lands, the default animal answers. */
AsyncStorage.getItem(STORAGE_KEY)
  .then((raw) => {
    hydrated = true;
    if (!raw || !isAvatarChoice(raw)) return;
    chosen = raw;
    announce();
  })
  .catch(() => { hydrated = true; /* unreadable — the default stands */ });

/** The chosen animal key, or null for "use the one my id hashes to". */
export function myAvatarAnimal() {
  return chosen;
}

/** Has the stored value been read yet? Lets a caller avoid a first-frame flip. */
export function avatarChoiceReady() {
  return hydrated;
}

/**
 * Pick an animal — or pass null to go back to the assigned one.
 *
 * Local first and synchronously, so the UI is already right when this returns;
 * the pond is told behind it. `api` is optional: without it (or with the pond
 * unreachable) the choice still holds on this device, which is the same
 * trade every other preference in the app makes.
 *
 * A null sent to PATCH /api/me/settings DELETES the key rather than storing a
 * null, which is `mergeUserSettings`'s documented behaviour — so "go back to
 * default" really clears it instead of leaving a tombstone.
 */
export async function setMyAvatarAnimal(next, api) {
  const value = isAvatarChoice(next) ? String(next) : null;
  if (value === chosen) return;
  chosen = value;
  hydrated = true;
  announce();

  try {
    if (value) await AsyncStorage.setItem(STORAGE_KEY, value);
    else await AsyncStorage.removeItem(STORAGE_KEY);
  } catch { /* the in-memory value still holds for this session */ }

  if (api?.patch) {
    try { await api.patch('/me/settings', { [SETTINGS_KEY]: value }); }
    catch { /* the pond will catch up the next time this is saved */ }
  }
}

/**
 * Adopt the pond's stored animal — called with `settings` from GET /api/me.
 *
 * Only fills a GAP: a device that has never had a choice made on it (a fresh
 * install, or a second phone). It must not overwrite a local pick, or opening
 * the profile would undo a choice made seconds earlier on this device while
 * the pond's own write was still in flight.
 */
export function adoptServerAvatarAnimal(settings) {
  if (chosen) return;
  const value = settings && typeof settings === 'object' ? settings[SETTINGS_KEY] : null;
  if (!isAvatarChoice(value)) return;
  chosen = String(value);
  hydrated = true;
  AsyncStorage.setItem(STORAGE_KEY, chosen).catch(() => {});
  announce();
}

/** Subscribe to changes. Returns the unsubscribe. */
export function subscribeAvatarChoice(listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Reset everything. For tests — nothing in the app calls this. */
export function __resetAvatarChoice() {
  chosen = null;
  hydrated = false;
  listeners.clear();
}

/** The chosen animal, re-rendering the caller when it changes. */
export function useMyAvatarAnimal() {
  const [value, setValue] = useState(chosen);
  useEffect(() => {
    // Read once on mount as well as on change: the AsyncStorage hydration may
    // have landed between this component's render and its effect.
    setValue(myAvatarAnimal());
    return subscribeAvatarChoice(() => setValue(myAvatarAnimal()));
  }, []);
  return value;
}

export default useMyAvatarAnimal;
