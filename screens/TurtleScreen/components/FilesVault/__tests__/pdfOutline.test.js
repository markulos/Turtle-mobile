import { flattenOutline, activeOutlineKey } from '../pdfOutline';

// The shape RNPDFPdfView.mm actually emits: pageIdx is a STRING and it is
// ZERO-based (PDFKit's indexForPage:).
const node = (title, pageIdx, children = []) => ({ title, pageIdx: String(pageIdx), mNativePtr: '', children });

describe('flattenOutline', () => {
  it('flattens nesting in reading order, with depth and 1-based pages', () => {
    const tree = [
      node('Introduction', 0),
      node('Methods', 4, [
        node('Sampling', 5),
        node('Analysis', 8, [node('Software', 9)]),
      ]),
      node('Results', 12),
    ];
    expect(flattenOutline(tree, { pageCount: 20 })).toEqual([
      { key: 'toc.0', title: 'Introduction', page: 1, depth: 0 },
      { key: 'toc.1', title: 'Methods', page: 5, depth: 0 },
      { key: 'toc.1.0', title: 'Sampling', page: 6, depth: 1 },
      { key: 'toc.1.1', title: 'Analysis', page: 9, depth: 1 },
      { key: 'toc.1.1.0', title: 'Software', page: 10, depth: 2 },
      { key: 'toc.2', title: 'Results', page: 13, depth: 0 },
    ]);
  });

  it('accepts the JSON string form the bridge sometimes sends', () => {
    const rows = flattenOutline(JSON.stringify([node('Cover', 0)]), { pageCount: 3 });
    expect(rows).toEqual([{ key: 'toc.0', title: 'Cover', page: 1, depth: 0 }]);
  });

  /**
   * indexForPage: returns NSNotFound for an entry pointing at a page the
   * document hasn't got, and `%lu` prints that as 18446744073709551615. Left
   * alone it becomes a row that jumps nowhere.
   */
  it('drops entries whose page is out of range, NSNotFound, or junk', () => {
    const tree = [
      node('Good', 2),
      node('NSNotFound', '18446744073709551615'),
      node('Past the end', 99),
      node('Negative', -3),
      node('Not a number', 'x'),
    ];
    expect(flattenOutline(tree, { pageCount: 10 }).map((r) => r.title)).toEqual(['Good']);
  });

  it('skips a titleless entry but keeps its children', () => {
    const tree = [node('', 0, [node('Buried', 1)])];
    expect(flattenOutline(tree, { pageCount: 5 })).toEqual([
      { key: 'toc.0.0', title: 'Buried', page: 2, depth: 1 },
    ]);
  });

  it('survives every malformed input the bridge could hand it', () => {
    expect(flattenOutline(null)).toEqual([]);
    expect(flattenOutline(undefined)).toEqual([]);
    expect(flattenOutline('not json')).toEqual([]);
    expect(flattenOutline({ title: 'not an array' })).toEqual([]);
    expect(flattenOutline([null, 'x', 7])).toEqual([]);
  });

  it('stops descending before a self-referencing outline can spin', () => {
    const loop = { title: 'Loop', pageIdx: '0', children: [] };
    loop.children.push(loop);
    expect(() => flattenOutline([loop], { pageCount: 5 })).not.toThrow();
    expect(flattenOutline([loop], { pageCount: 5 }).length).toBeLessThanOrEqual(7);
  });
});

describe('activeOutlineKey', () => {
  // Straight equality would leave nothing highlighted for every page between
  // two headings — on a long chapter, that is most of them.
  it('is the last heading at or before the page', () => {
    const rows = [
      { key: 'a', page: 1 },
      { key: 'b', page: 5 },
      { key: 'c', page: 12 },
    ];
    expect(activeOutlineKey(rows, 1)).toBe('a');
    expect(activeOutlineKey(rows, 4)).toBe('a');
    expect(activeOutlineKey(rows, 5)).toBe('b');
    expect(activeOutlineKey(rows, 11)).toBe('b');
    expect(activeOutlineKey(rows, 400)).toBe('c');
  });

  it('is null before the first heading, and safe on nothing', () => {
    expect(activeOutlineKey([{ key: 'a', page: 3 }], 1)).toBeNull();
    expect(activeOutlineKey([], 5)).toBeNull();
    expect(activeOutlineKey(undefined, 5)).toBeNull();
  });
});
