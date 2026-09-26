/**
 * peopleFrequency — who you actually put on tasks, so the picker can offer them
 * before you search for them.
 *
 * "Most common people involved" is not something the server knows to answer and
 * not something a friends list can tell you: a pond of twelve has three you
 * work with. So it is counted HERE, from your own saves — every time a task is
 * written with people on it, each of them is bumped. A handful of taps in and
 * the top of the picker is the three names you were going to type.
 *
 * Kept in AsyncStorage rather than derived from the task list on the fly,
 * because the list the form has is one board's worth or one day's worth, and
 * the question spans everything you have ever assigned. It is also, deliberately,
 * a LOCAL signal — this is about the shortcut in front of you, not a fact about
 * the pond worth syncing.
 *
 * The ranking is pure and exported on its own so it can be reasoned about
 * without a storage layer in the way.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'turtle.peopleFrequency.v1';

/**
 * Ids ordered by how often they have been involved, most first.
 *
 * Ties break on the id so the order is STABLE: a picker whose top three
 * reshuffle between renders because two people are level on 4 is a picker you
 * cannot build muscle memory against.
 *
 * `exclude` drops whoever is already on the task — a suggestion you have
 * already taken is a row that does nothing, and it pushes the one useful
 * suggestion off the end of three.
 */
export function rankPeople(counts, { limit = 3, exclude = [] } = {}) {
  const skip = new Set(exclude || []);
  return Object.entries(counts || {})
    .filter(([id, n]) => id && Number(n) > 0 && !skip.has(id))
    .sort((a, b) => (Number(b[1]) - Number(a[1])) || String(a[0]).localeCompare(String(b[0])))
    .slice(0, Math.max(0, limit))
    .map(([id]) => id);
}

/** The whole tally, or {} when there is nothing stored (or it is unreadable). */
export async function loadCounts() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch {
    // A corrupt tally is a suggestion list, not data — start it again rather
    // than making the form's save path care.
    return {};
  }
}

/**
 * Count one save. Ids are de-duplicated first: a task carrying the same person
 * twice (the owner is routinely in their own involvedUsers) must not count them
 * twice.
 *
 * Failures are swallowed on purpose. This is a convenience ranking; a task that
 * saved correctly must not surface an error because a shortcut list did not.
 */
export async function bumpInvolved(ids) {
  const unique = [...new Set((ids || []).filter(Boolean).map(String))];
  if (!unique.length) return;
  try {
    const counts = await loadCounts();
    for (const id of unique) counts[id] = (Number(counts[id]) || 0) + 1;
    await AsyncStorage.setItem(KEY, JSON.stringify(counts));
  } catch { /* a shortcut list is not worth failing a save over */ }
}
