import { zipSync, strToU8 } from 'fflate';
import {
  isDocx, isLegacyDoc, parseDocumentXml, readDocx,
} from '../docx';

/**
 * Reading a Word file without leaving the app.
 *
 * Mark, 2026-11-17: "can you make the mobile app support opening word files?"
 * Four files in this repo carried the line "the OS previews a .docx and we
 * cannot"; this is what changed that.
 *
 * The fixtures are REAL ZIPs built with fflate rather than hand-written
 * objects, because half the job is the container: a parser that works on a
 * string and has never been handed a deflate stream has not been tested on
 * the thing it will actually meet.
 */

const body = (inner) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${inner}</w:body></w:document>`;

const para = (text, { style, bold, list } = {}) => {
  const props = [style ? `<w:pStyle w:val="${style}"/>` : '', list ? '<w:numPr><w:ilvl w:val="0"/></w:numPr>' : ''].join('');
  const rPr = bold ? '<w:rPr><w:b/></w:rPr>' : '';
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}<w:r>${rPr}<w:t>${text}</w:t></w:r></w:p>`;
};

/** A real .docx: a zip whose `word/document.xml` is the body given. */
const docxOf = (inner, extra = {}) => zipSync({
  '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
  'word/document.xml': strToU8(body(inner)),
  ...extra,
});

describe('isDocx / isLegacyDoc', () => {
  test('the EXTENSION decides, because a mime type is whatever the uploader said', () => {
    expect(isDocx({ originalName: 'Minutes.DOCX' })).toBe(true);
    expect(isDocx({ filename: 'notes.docx' })).toBe(true);
    expect(isDocx({ originalName: 'notes.pdf' })).toBe(false);
    // A name that merely contains the word is not one.
    expect(isDocx({ originalName: 'how-to-open-docx.pdf' })).toBe(false);
  });

  test('…and the mime type only gets a say when there is no name to read', () => {
    const W = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    expect(isDocx({ originalName: 'scan', mimeType: W })).toBe(true);
    expect(isDocx({ originalName: 'scan.pdf', mimeType: W })).toBe(false);
  });

  test('THE OLD .doc IS NOT THIS, and must not be treated as it', () => {
    // A compound file of undocumented records, not a zip of XML. Pretending
    // to read it would be worse than handing it to something that can.
    expect(isLegacyDoc({ originalName: 'archive.doc' })).toBe(true);
    expect(isDocx({ originalName: 'archive.doc' })).toBe(false);
  });
});

describe('readDocx', () => {
  test('reads a REAL zip: headings, prose, lists and emphasis', () => {
    const blocks = readDocx(docxOf([
      para('Site visit', { style: 'Heading1' }),
      para('Sub point', { style: 'Heading2' }),
      para('Met Olof at nine.'),
      para('Measure the alcove', { list: true }),
      para('All bold', { bold: true }),
    ].join('')));
    expect(blocks.map((b) => b.text)).toEqual([
      'Site visit', 'Sub point', 'Met Olof at nine.', 'Measure the alcove', 'All bold',
    ]);
    expect(blocks[0].heading).toBe(1);
    expect(blocks[1].heading).toBe(2);
    expect(blocks[3].listed).toBe(true);
    expect(blocks[4].bold).toBe(true);
    // A paragraph whose runs are not ALL bold is not a bold paragraph.
    expect(blocks[2].bold).toBe(false);
  });

  test('a sentence with one bold word is not a bold sentence', () => {
    // The common case, and the one a naive "does it contain <w:b/>" gets
    // wrong — it would embolden most paragraphs in most documents.
    const mixed = '<w:p><w:r><w:t>Met </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>Olof</w:t></w:r><w:r><w:t> at nine.</w:t></w:r></w:p>';
    const [b] = readDocx(docxOf(mixed));
    expect(b.text).toBe('Met Olof at nine.');
    expect(b.bold).toBe(false);
  });

  test('`w:val="0"` turns a toggle OFF rather than on', () => {
    const off = '<w:p><w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>Not bold</w:t></w:r></w:p>';
    expect(readDocx(docxOf(off))[0].bold).toBe(false);
  });

  test('breaks and tabs survive; empty paragraphs do not', () => {
    const inner = '<w:p><w:r><w:t>One</w:t><w:br/><w:t>Two</w:t></w:r></w:p>'
      + '<w:p/>'
      + '<w:p><w:r><w:t>A</w:t><w:tab/><w:t>B</w:t></w:r></w:p>';
    const blocks = readDocx(docxOf(inner));
    expect(blocks.map((b) => b.text)).toEqual(['One\nTwo', 'A\tB']);
  });

  test('A TABLE IS FLATTENED, not dropped', () => {
    // A minutes document whose decisions live in a table is worse than
    // useless with the table silently missing — and marked, so a reader can
    // tell cells from prose.
    const cell = (t) => `<w:tc><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`;
    const tbl = `<w:tbl><w:tr>${cell('Item')}${cell('Qty')}</w:tr><w:tr>${cell('Hinges')}${cell('8')}</w:tr></w:tbl>`;
    const blocks = readDocx(docxOf(tbl));
    expect(blocks).toHaveLength(2);
    expect(blocks[0].cell).toBe(true);
    expect(blocks[0].text).toContain('Item');
    expect(blocks[0].text).toContain('Qty');
    expect(blocks[1].text).toContain('Hinges');
  });

  test('…and it keeps DOCUMENT ORDER across paragraphs and tables', () => {
    const inner = `${para('Before')}<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Middle</w:t></w:r></w:p></w:tc></w:tr></w:tbl>${para('After')}`;
    expect(readDocx(docxOf(inner)).map((b) => b.text)).toEqual(['Before', 'Middle', 'After']);
  });

  test('XML entities come back as the characters they stand for', () => {
    // `&amp;` LAST, or "&amp;lt;" unescapes twice and a document about XML
    // reads as one that is broken.
    const blocks = readDocx(docxOf(para('Tom &amp; Jerry &lt;tag&gt; &quot;q&quot; &amp;lt;')));
    expect(blocks[0].text).toBe('Tom & Jerry <tag> "q" &lt;');
  });

  test('a file that is not a zip says so, in a sentence worth showing', () => {
    // This runs behind a viewer; "undefined is not an object" is not
    // something to put on a screen.
    expect(() => readDocx(new Uint8Array([1, 2, 3, 4]))).toThrow(/Word document/);
  });

  test('…and so does a zip with no document part', () => {
    const notWord = zipSync({ 'hello.txt': strToU8('hi') });
    expect(() => readDocx(notWord)).toThrow(/Word document/);
  });

  test('…and an empty document is named as empty, not as broken', () => {
    expect(() => readDocx(docxOf('<w:p/><w:p/>'))).toThrow(/no text/);
  });

  test('ONLY the document part is inflated', () => {
    // A .docx carries fonts, images and a media folder; inflating all of it
    // to read the text would be most of the work for none of the benefit.
    const heavy = docxOf(para('Light'), {
      'word/media/image1.png': new Uint8Array(400000),
      'word/fontTable.xml': strToU8('<x/>'),
    });
    expect(readDocx(heavy).map((b) => b.text)).toEqual(['Light']);
  });
});

describe('parseDocumentXml', () => {
  test('it is usable on its own, on a body without the envelope', () => {
    // The viewer only ever hands it a whole document, but the parser is the
    // piece worth being able to reason about alone.
    expect(parseDocumentXml(para('Bare')).map((b) => b.text)).toEqual(['Bare']);
    expect(parseDocumentXml('')).toEqual([]);
    expect(parseDocumentXml(null)).toEqual([]);
  });
});
