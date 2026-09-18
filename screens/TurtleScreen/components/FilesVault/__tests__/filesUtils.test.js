import {
  folderHue, folderColor, folderTint, formatSize, documentIcon, isDocument, collapseCrumbs, sortFolderItems,
} from '../filesUtils';

describe('filesUtils', () => {
  it('hues are stable per name and inside 0..359', () => {
    expect(folderHue('Taxes')).toBe(folderHue('Taxes'));
    expect(folderHue('Taxes')).not.toBe(folderHue('Receipts'));
    for (const n of ['a', 'Taxes', 'Ünïcode 🎉']) expect(folderHue(n)).toBeGreaterThanOrEqual(0);
    for (const n of ['a', 'Taxes', 'Ünïcode 🎉']) expect(folderHue(n)).toBeLessThan(360);
    expect(folderColor('Taxes')).toMatch(/^hsl\(\d+, 55%, 55%\)$/);
    expect(folderTint('Taxes', 0.2)).toMatch(/^hsla\(\d+, 55%, 55%, 0\.2\)$/);

    // Parity with boardColor (ConversationsOverlay.jsx): code-unit iteration, not
    // code-point — must agree on emoji/non-BMP names too. Recomputed here rather
    // than imported, since ConversationsOverlay.jsx is a component module with
    // native deps.
    const boardsWay = (name) => { let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360; return h; };
    expect(folderHue('🎉')).toBe(boardsWay('🎉'));
    expect(folderHue('Ünïcode 🎉')).toBe(boardsWay('Ünïcode 🎉'));
    expect(folderHue('🎉')).toBe(261);
  });

  it('formats sizes for a row', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(12 * 1024)).toBe('12 KB');
    expect(formatSize(3.4 * 1024 * 1024)).toBe('3.4 MB');
    expect(formatSize(null)).toBe('');
  });

  it('picks a typed icon and recognises documents', () => {
    expect(documentIcon({ originalName: 'a.pdf' })).toBe('file-pdf-box');
    expect(documentIcon({ originalName: 'a.docx' })).toBe('file-word-box');
    expect(documentIcon({ originalName: 'a.xlsx' })).toBe('file-excel-box');
    expect(documentIcon({ originalName: 'a.pptx' })).toBe('file-powerpoint-box');
    expect(documentIcon({ originalName: 'a.zip' })).toBe('folder-zip-outline');
    expect(documentIcon({ originalName: 'a.json' })).toBe('code-json');
    expect(documentIcon({ originalName: 'notes.txt' })).toBe('file-document-outline');
    expect(documentIcon({ filename: 'x.md' })).toBe('language-markdown');
    expect(isDocument({ type: 'document' })).toBe(true);
    expect(isDocument({ type: 'image' })).toBe(false);
    expect(isDocument({})).toBe(false);
  });

  it('collapses long crumb chains to Files › … › Parent › Name', () => {
    const chain = [{ id: 'a', name: 'Scans' }, { id: 'b', name: 'Taxes' }, { id: 'c', name: '2025' }, { id: 'd', name: 'Receipts' }];
    expect(collapseCrumbs(chain).map((c) => c.name)).toEqual(['Scans', '…', '2025', 'Receipts']);
    expect(collapseCrumbs(chain.slice(0, 3)).map((c) => c.name)).toEqual(['Scans', 'Taxes', '2025']);
    expect(collapseCrumbs([]).length).toBe(0);
    expect(collapseCrumbs(chain)[1].ellipsis).toBe(true);
  });

  it('re-sorts a page the same way the server does', () => {
    const items = [
      { id: '1', originalName: 'b.pdf', size: 5, uploadDate: 100, type: 'document' },
      { id: '2', originalName: 'a.jpg', size: 50, uploadDate: 300, type: 'image', originalDate: 50 },
      { id: '3', filename: 'C.pdf', size: 20, uploadDate: 200, type: 'document' },
    ];
    expect(sortFolderItems(items, 'name', 'asc').map((i) => i.id)).toEqual(['2', '1', '3']);
    expect(sortFolderItems(items, 'size', 'desc').map((i) => i.id)).toEqual(['2', '3', '1']);
    expect(sortFolderItems(items, 'date', 'desc').map((i) => i.id)).toEqual(['3', '1', '2']);
    expect(sortFolderItems(items, 'type', 'asc').map((i) => i.id)).toEqual(['1', '3', '2']);
    expect(sortFolderItems(items, 'nope', 'asc')).not.toBe(items);
  });
});
