/**
 * The people on a note, in the order their faces are drawn.
 *
 * THE AUTHOR IS FIRST, always. That is the whole rule, and it is the same one
 * tasks follow (a task row leads with its owner's disc) — the first face answers
 * "whose is this", and the ones behind it answer "who else is on it".
 * `FaceStack` then paints first-on-top, so the author overlaps their neighbour
 * rather than being buried under whoever was added last.
 *
 * ── Why a pure function and not markup in the card ────────────────────────
 * Two things here are easy to get wrong and invisible when they are:
 *   - the author ALSO appearing in `involvedUsers`, which the server does not
 *     forbid — a note would then show the same person twice;
 *   - an id with nobody behind it (a member removed from the pond, or simply a
 *     people map that has not landed yet), which must still draw a face.
 * Both are list arithmetic, so they are tested as list arithmetic.
 */

/**
 * `people` for FaceStack: `[{ userId, name, avatarUrl }]`, author first.
 *
 * `peopleById` is a Map (utils/usePondPeople) and may be empty — an id it cannot
 * resolve still becomes a face, because `AnimalAvatar` draws a stable disc from
 * the id alone. A nameless face is a person whose name we have not learned yet;
 * a missing face is a person who has been silently dropped.
 */
export function notePeopleRoster(note, peopleById) {
  const out = [];
  const seen = new Set();

  const add = (person) => {
    const userId = String(person?.userId || '').trim();
    if (!userId || seen.has(userId)) return;
    seen.add(userId);
    out.push(person);
  };

  // The author, from the note's own row — it already carries the name and the
  // avatar, so this face never waits on the people map.
  const by = note?.sharedBy;
  if (by && String(by.userId || '').trim()) {
    add({ userId: String(by.userId), name: by.name || null, avatarUrl: by.avatarUrl || null });
  }

  const involved = Array.isArray(note?.involvedUsers) ? note.involvedUsers : [];
  for (const raw of involved) {
    const userId = String(raw || '').trim();
    if (!userId) continue;
    const known = peopleById && typeof peopleById.get === 'function' ? peopleById.get(userId) : null;
    add({
      userId,
      name: known?.name || null,
      avatarUrl: known?.avatarUrl || null,
    });
  }

  return out;
}

/**
 * What the row says out loud. The byline beside the faces already prints the
 * author's name, so this is the part that name cannot carry — and it is what
 * someone using a screen reader gets instead of the overlap.
 */
export function notePeopleLabel(roster) {
  const list = Array.isArray(roster) ? roster : [];
  if (list.length === 0) return '';
  const author = list[0].name || 'A member';
  if (list.length === 1) return `Written by ${author}`;
  const others = list.length - 1;
  return `Written by ${author}, with ${others} ${others === 1 ? 'other person' : 'others'}`;
}
