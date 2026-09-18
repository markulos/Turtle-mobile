/**
 * The vault's virtual slot array — built once, patched after that.
 *
 * The grid's data spans the WHOLE library: a contiguous newest prefix of real
 * rows, sparse-loaded pages wherever the user has scrolled, and a cached
 * skeleton object everywhere else. With 28k photos that array is 28k entries
 * long, and it was rebuilt from scratch every time a page landed — a full pass
 * of Map lookups, modulo and Set probes, allocating a fresh 28k array each
 * time. Pages land in waves WHILE THE GRID IS MOVING, so that pass ran on the
 * JS thread exactly when the fling needed it: the stutter you feel as tiles
 * resolve.
 *
 * Nothing about a landed page changes any slot outside that page. So: build
 * the array once, then copy it and rewrite ONLY the ranges whose pages
 * changed. A copy of 28k references is a memcpy the engine does far faster
 * than 28k iterations of JS, and the rewritten range is a couple of hundred
 * slots rather than all of them.
 *
 * Free of react-native imports (same rule as `statsFormat` and `zoomMath`) so
 * the equivalence that matters — patched === rebuilt — is unit-testable.
 */

/**
 * Write `out[i]` for every i in [from, to): the row from its sparse page, or
 * the skeleton that stands in for it.
 *
 * `prefixIds` is why a page row can be rejected: counts shift between the
 * buckets fetch and a page fetch, so the same photo can appear both in the
 * newest prefix and in a page. Two cells with one key breaks FlashList's
 * keyExtractor contract, so the later copy becomes a skeleton.
 */
function fillRange(out, from, to, { pageSize, pages, slotAt, prefixIds }) {
  for (let i = from; i < to; i += 1) {
    const page = pages.get(Math.floor(i / pageSize));
    const it = page ? page[i % pageSize] : null;
    out[i] = (it && it.id && !prefixIds.has(it.id)) ? it : slotAt(i);
  }
}

/**
 * The full build. Returns the array AND the prefix id set, because patching
 * needs the same set and recomputing it would undo the point.
 */
export function buildSlots({ prefix, total, pageSize, pages, slotAt }) {
  const rows = prefix || [];
  const prefixIds = new Set();
  for (let i = 0; i < rows.length; i += 1) prefixIds.add(rows[i].id);
  const head = Math.min(rows.length, total);
  const out = new Array(total);
  for (let i = 0; i < head; i += 1) out[i] = rows[i];
  fillRange(out, head, total, { pageSize, pages, slotAt, prefixIds });
  return { slots: out, prefixIds };
}

/**
 * Rewrite only the given pages. The prefix is never touched: a page that
 * overlaps it has already lost that argument (the prefix rows are the
 * authoritative copy), so each range starts at `prefixLen` at the earliest.
 *
 * Page indices that fall entirely inside the prefix, or past the end, write
 * nothing — so an eviction near either edge is a no-op rather than an error.
 */
export function patchSlots({
  base, prefixIds, pageIndices, prefixLen, total, pageSize, pages, slotAt,
}) {
  const out = base.slice();
  for (const p of pageIndices) {
    const from = Math.max(prefixLen, p * pageSize);
    const to = Math.min(total, (p + 1) * pageSize);
    if (to > from) fillRange(out, from, to, { pageSize, pages, slotAt, prefixIds });
  }
  return out;
}

/**
 * How many slots a patch would rewrite. The caller uses this to decide
 * between patching and rebuilding: past roughly the length of the array the
 * copy-plus-patch stops being the cheaper of the two.
 */
export function patchCost({ pageIndices, prefixLen, total, pageSize }) {
  let n = 0;
  for (const p of pageIndices) {
    const from = Math.max(prefixLen, p * pageSize);
    const to = Math.min(total, (p + 1) * pageSize);
    if (to > from) n += to - from;
  }
  return n;
}
