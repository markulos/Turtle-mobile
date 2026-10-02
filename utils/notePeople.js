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
/** The people map is a Map, but callers may hand over nothing at all. */
function lookup(peopleById, userId) {
  if (!peopleById || typeof peopleById.get !== 'function') return null;
  return peopleById.get(userId) || null;
}

export function notePeopleRoster(note, peopleById) {
  const out = [];
  const seen = new Set();

  const add = (person) => {
    const userId = String(person?.userId || '').trim();
    if (!userId || seen.has(userId)) return;
    seen.add(userId);
    out.push(person);
  };

  // The author. A plain note's own row carries their name AND their picture, so
  // that face never waits on the people map; a to-do row built from a TASK
  // carries only the name, because the tasks DTO has no avatar on it. So the
  // row wins where it has an answer and the map fills in the rest — rather than
  // the row's `null` pinning the face to "this person has no photo".
  const by = note?.sharedBy;
  const authorId = String(by?.userId || '').trim();
  if (authorId) {
    const known = lookup(peopleById, authorId);
    add({
      userId: authorId,
      name: by.name || known?.name || null,
      avatarUrl: by.avatarUrl || known?.avatarUrl || null,
    });
  }

  const involved = Array.isArray(note?.involvedUsers) ? note.involvedUsers : [];
  for (const raw of involved) {
    const userId = String(raw || '').trim();
    if (!userId) continue;
    const known = lookup(peopleById, userId);
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
