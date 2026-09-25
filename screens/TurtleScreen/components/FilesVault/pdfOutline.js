/**
 * The PDF's own table of contents, flattened into rows the index panel can
 * draw. Pure — no React, no native — so the awkward parts are unit-tested
 * rather than discovered on a 300-page document.
 *
 * What react-native-pdf hands us (iOS, RNPDFPdfView.mm) is a tree of
 * `{ title, pageIdx, children[] }`, and two details of that shape are traps:
 *
 *   · `pageIdx` is a STRING, and it is ZERO-BASED — it comes straight from
 *     PDFKit's `indexForPage:`. Page one arrives as "0".
 *   · When an outline entry points at a page the document doesn't actually
 *     have, `indexForPage:` returns NSNotFound, which `%lu` prints as
 *     18446744073709551615. Unguarded, that becomes a row that jumps nowhere.
 *
 * Both are handled here so the panel can treat every row as a plain 1-based
 * page number it can trust.
 */

// Deep enough for any real document's numbering (1 / 1.2 / 1.2.3 / 1.2.3.4),
// shallow enough that a malformed self-referencing outline cannot spin.
const MAX_DEPTH = 6;

/**
 * @param raw   the `tableContents` argument of onLoadComplete: an array, or
 *              the JSON string it sometimes arrives as.
 * @param opts.pageCount  total pages, used to reject out-of-range entries.
 * @returns [{ key, title, page, depth }] in reading order.
 */
export function flattenOutline(raw, { pageCount = 0 } = {}) {
  let tree = raw;
  if (typeof tree === 'string') {
    try { tree = JSON.parse(tree); } catch { return []; }
  }
  if (!Array.isArray(tree)) return [];

  const rows = [];
  const walk = (nodes, depth, path) => {
    if (depth > MAX_DEPTH || !Array.isArray(nodes)) return;
    nodes.forEach((node, i) => {
      if (!node || typeof node !== 'object') return;
      const key = `${path}.${i}`;
      const title = String(node.title == null ? '' : node.title).trim();
      const page = pageOf(node.pageIdx, pageCount);
      // A titleless entry is not worth a row, but its children may well be —
      // they keep their own depth so the indentation still reads correctly.
      if (title && page) rows.push({ key, title, page, depth });
      walk(node.children, depth + 1, key);
    });
  };
  walk(tree, 0, 'toc');
  return rows;
}

/** "0" → 1. Junk, negatives and NSNotFound → null (the row is dropped). */
function pageOf(pageIdx, pageCount) {
  const n = Number(pageIdx);
  if (!Number.isFinite(n) || n < 0) return null;
  const page = Math.floor(n) + 1;
  if (page < 1) return null;
  if (pageCount > 0 && page > pageCount) return null;
  // Even with no pageCount to check against, NSNotFound must not survive.
  if (!Number.isSafeInteger(page)) return null;
  return page;
}

/**
 * Which outline row the reader is "in" — the last one at or before the current
 * page. Straight equality would leave nothing highlighted for every page
 * between two headings, which on a long chapter is most of them.
 */
export function activeOutlineKey(rows, page) {
  let active = null;
  for (const row of rows || []) {
    if (row.page <= page) active = row.key;
    else break;
  }
  return active;
}
