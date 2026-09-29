/**
 * How many faces fit in the room a row can spare, and what the rest become.
 *
 * A stack of avatars is the one control whose size is decided by its CONTENT,
 * so it is the one that pushes a title off the end of a card. The rule here is
 * the opposite: the row says how much space there is, and the stack takes only
 * that, turning everyone who did not fit into a "+n" disc.
 *
 * Pure, because the alternative is discovering the overflow on a 375pt phone
 * with a four-word board name and six people on it.
 *
 * GEOMETRY. Discs overlap by `overlap`, so the first costs its whole width and
 * every one after it costs `size - overlap`:
 *
 *     width(n) = size + (n - 1) * (size - overlap)
 *
 * The "+n" disc is the same size and overlaps the same way, so a stack that
 * needs one costs `width(n) + (size - overlap)`.
 */

/** STYLE-RULES §5: a third, so each extra face costs two thirds of a disc. */
export const overlapFor = (size) => Math.round(size / 3);

/** The width a stack of `n` discs occupies at this size and overlap. */
export const stackWidth = (n, size, overlap = overlapFor(size)) => (
  n <= 0 ? 0 : size + (n - 1) * (size - overlap)
);

/**
 * Split `total` people into the faces that fit and the number that do not.
 *
 * `max` is a hard cap on top of the width (past four discs they stop reading as
 * faces at all). `available` is the room the row can give the stack.
 *
 * Returns { shown, overflow }. Never returns shown: 0 while there is room for a
 * single disc — one face and a "+5" is a stack; a bare "+6" is a number nobody
 * can read as people.
 */
export function facesThatFit({ total, available, size, max = 4, overlap }) {
  const n = Math.max(0, Math.floor(Number(total) || 0));
  if (n === 0) return { shown: 0, overflow: 0 };
  const s = Number(size) || 0;
  const o = overlap == null ? overlapFor(s) : overlap;
  const room = Number(available) || 0;
  if (s <= 0 || room < s) return { shown: 0, overflow: n };

  const cap = Math.min(n, Math.max(1, Math.floor(max)));
  // Everyone fits, with nothing left over to count.
  if (cap === n && stackWidth(n, s, o) <= room) return { shown: n, overflow: 0 };

  // Otherwise the stack ends in a "+n" disc, which has to fit too.
  let shown = 0;
  for (let i = 1; i <= cap; i += 1) {
    if (stackWidth(i, s, o) + (s - o) <= room) shown = i;
    else break;
  }
  // Room for one disc but not for a face AND the counter: show the face. The
  // overflow is still reported, so the caller can put it in the a11y label.
  if (shown === 0) shown = 1;
  return { shown, overflow: n - shown };
}

/**
 * The people a stack should draw, in order, de-duplicated.
 *
 * DE-DUPLICATION IS NOT COSMETIC: an owner is routinely also listed among the
 * people something is shared with, and two of the same face reads as a bug.
 * Identity is the user id where there is one, falling back to the name so a
 * record that arrived without an id still collapses with its twin.
 */
export function rosterOf(people = []) {
  const seen = new Set();
  const out = [];
  for (const p of Array.isArray(people) ? people : []) {
    if (!p) continue;
    const key = String(p.userId ?? p.id ?? p.name ?? '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}
