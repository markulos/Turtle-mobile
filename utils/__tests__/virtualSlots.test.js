/**
 * The property that matters: a patched array is indistinguishable from a
 * rebuilt one. Everything else here is an edge of that claim.
 */
import { buildSlots, patchSlots, patchCost } from '../virtualSlots';

const SLOTS = new Map();
const slotAt = (i) => {
  if (!SLOTS.has(i)) SLOTS.set(i, { id: `vskel-${i}`, isSkeleton: true });
  return SLOTS.get(i);
};

const row = (i) => ({ id: `m${i}`, filename: `${i}.jpg` });
const pageOf = (p, size) => Array.from({ length: size }, (_, k) => row(p * size + k));

const PAGE = 10;
const TOTAL = 95;

const rebuild = (prefix, pages) =>
  buildSlots({ prefix, total: TOTAL, pageSize: PAGE, pages, slotAt }).slots;

describe('buildSlots', () => {
  test('prefix rows, then page rows, then skeletons for the rest', () => {
    const pages = new Map([[3, pageOf(3, PAGE)]]);
    const { slots } = buildSlots({ prefix: [row(0), row(1)], total: TOTAL, pageSize: PAGE, pages, slotAt });

    expect(slots).toHaveLength(TOTAL);
    expect(slots[0]).toEqual(row(0));           // prefix
    expect(slots[30].id).toBe('m30');           // page 3 covers 30..39
    expect(slots[39].id).toBe('m39');
    expect(slots[40].isSkeleton).toBe(true);    // no page 4
    expect(slots[2].isSkeleton).toBe(true);     // past the prefix, no page 0
  });

  test('a page row that duplicates a prefix id becomes a skeleton', () => {
    // Counts shift between fetches, so the same photo can arrive twice. Two
    // cells with one key breaks FlashList's keyExtractor contract.
    const pages = new Map([[2, pageOf(2, PAGE)]]);
    const { slots } = buildSlots({ prefix: [row(20)], total: TOTAL, pageSize: PAGE, pages, slotAt });

    expect(slots[0].id).toBe('m20');            // the prefix copy stands
    expect(slots[20].isSkeleton).toBe(true);    // the page copy does not
    expect(slots[21].id).toBe('m21');           // its neighbours are unaffected
  });

  test('an empty library and an empty prefix are both just skeletons', () => {
    expect(buildSlots({ prefix: [], total: 0, pageSize: PAGE, pages: new Map(), slotAt }).slots).toEqual([]);
    const { slots } = buildSlots({ prefix: [], total: 3, pageSize: PAGE, pages: new Map(), slotAt });
    expect(slots.every((s) => s.isSkeleton)).toBe(true);
  });
});

describe('patchSlots === a rebuild', () => {
  test('one page landing', () => {
    const prefix = [row(0), row(1), row(2)];
    const pages = new Map([[3, pageOf(3, PAGE)]]);
    const { slots, prefixIds } = buildSlots({ prefix, total: TOTAL, pageSize: PAGE, pages, slotAt });

    pages.set(6, pageOf(6, PAGE));
    const patched = patchSlots({
      base: slots, prefixIds, pageIndices: [6], prefixLen: prefix.length,
      total: TOTAL, pageSize: PAGE, pages, slotAt,
    });

    expect(patched).toEqual(rebuild(prefix, pages));
    expect(patched[60].id).toBe('m60');
    expect(patched).not.toBe(slots);   // a new identity, so FlashList re-reads
    expect(slots[60].isSkeleton).toBe(true); // ...and the old array is untouched
  });

  test('a wave of pages landing together', () => {
    const prefix = [row(0)];
    const pages = new Map();
    const { slots, prefixIds } = buildSlots({ prefix, total: TOTAL, pageSize: PAGE, pages, slotAt });

    for (const p of [2, 3, 4, 5, 6]) pages.set(p, pageOf(p, PAGE));
    const patched = patchSlots({
      base: slots, prefixIds, pageIndices: [2, 3, 4, 5, 6], prefixLen: prefix.length,
      total: TOTAL, pageSize: PAGE, pages, slotAt,
    });

    expect(patched).toEqual(rebuild(prefix, pages));
  });

  test('an EVICTED page goes back to skeletons', () => {
    const prefix = [row(0)];
    const pages = new Map([[4, pageOf(4, PAGE)], [5, pageOf(5, PAGE)]]);
    const { slots, prefixIds } = buildSlots({ prefix, total: TOTAL, pageSize: PAGE, pages, slotAt });
    expect(slots[40].id).toBe('m40');

    pages.delete(4);
    const patched = patchSlots({
      base: slots, prefixIds, pageIndices: [4], prefixLen: prefix.length,
      total: TOTAL, pageSize: PAGE, pages, slotAt,
    });

    expect(patched[40].isSkeleton).toBe(true);
    expect(patched[50].id).toBe('m50');  // the page that stayed is still there
    expect(patched).toEqual(rebuild(prefix, pages));
  });

  test('the LAST page is short and must not run past the end', () => {
    const prefix = [row(0)];
    const pages = new Map();
    const { slots, prefixIds } = buildSlots({ prefix, total: TOTAL, pageSize: PAGE, pages, slotAt });

    pages.set(9, pageOf(9, PAGE)); // 90..99, but the library stops at 95
    const patched = patchSlots({
      base: slots, prefixIds, pageIndices: [9], prefixLen: prefix.length,
      total: TOTAL, pageSize: PAGE, pages, slotAt,
    });

    expect(patched).toHaveLength(TOTAL);
    expect(patched[94].id).toBe('m94');
    expect(patched).toEqual(rebuild(prefix, pages));
  });

  test('a page buried in the prefix, or past the end, writes nothing', () => {
    const prefix = Array.from({ length: 25 }, (_, i) => row(i));
    const pages = new Map([[0, pageOf(0, PAGE)]]);
    const { slots, prefixIds } = buildSlots({ prefix, total: TOTAL, pageSize: PAGE, pages, slotAt });

    const patched = patchSlots({
      base: slots, prefixIds, pageIndices: [0, 99], prefixLen: prefix.length,
      total: TOTAL, pageSize: PAGE, pages, slotAt,
    });

    expect(patched).toEqual(slots);
    expect(patched[0].id).toBe('m0');  // still the prefix's own row
  });
});

describe('patchCost', () => {
  test('counts only the slots a patch would actually write', () => {
    expect(patchCost({ pageIndices: [6], prefixLen: 3, total: TOTAL, pageSize: PAGE })).toBe(10);
    // Page 9 is 90..99 against a 95-long library.
    expect(patchCost({ pageIndices: [9], prefixLen: 3, total: TOTAL, pageSize: PAGE })).toBe(5);
    // Page 0 sits entirely under a 25-row prefix.
    expect(patchCost({ pageIndices: [0], prefixLen: 25, total: TOTAL, pageSize: PAGE })).toBe(0);
    expect(patchCost({ pageIndices: [], prefixLen: 0, total: TOTAL, pageSize: PAGE })).toBe(0);
  });
});
