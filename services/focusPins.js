/**
 * focusPins — the tasks kept at the top of the Focus deck's list, remembered.
 *
 * A pin is a PREFERENCE, not a view's state: it has to survive leaving the
 * tab, and leaving the app. On this phone only — pinning something is about
 * what you are working on here, and syncing it would need a server field for
 * a thing nobody has asked to share.
 *
 * Everything is swallowed. Storage that will not answer costs you the pins,
 * which is a list of five ids; it must never cost you the Focus tab.
 */
/**
 * AsyncStorage is required LAZILY, inside the two functions that touch it.
 *
 * Imported at module scope it drags the native module into every suite that
 * wants the pure helpers — the documented trap (see utils/inputField, and
 * components/Grain, which is a prop-taking leaf for the same reason). Both
 * functions already accept a storage to inject; this is only the default.
 */
const defaultStorage = () => require('@react-native-async-storage/async-storage').default;

export const PINS_KEY = '@turtle_focus_pins';
/**
 * A ceiling, because the list is drawn above the fold. Past about this many
 * "pinned to the top" stops meaning anything — everything is at the top.
 */
export const MAX_PINS = 8;

/** Ids only, strings only, de-duplicated, capped. Junk in storage is dropped. */
export function normalizePins(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const id of raw) {
    if (typeof id !== 'string' || !id || out.includes(id)) continue;
    out.push(id);
    if (out.length >= MAX_PINS) break;
  }
  return out;
}

export async function loadPins(storage) {
  const store = storage || defaultStorage();
  try {
    return normalizePins(JSON.parse(await store.getItem(PINS_KEY)));
  } catch {
    return [];
  }
}

export async function savePins(pins, storage) {
  const store = storage || defaultStorage();
  try {
    await store.setItem(PINS_KEY, JSON.stringify(normalizePins(pins)));
    return true;
  } catch {
    return false;
  }
}

export default { PINS_KEY, MAX_PINS, loadPins, normalizePins, savePins };
