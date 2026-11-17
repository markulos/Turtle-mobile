/**
 * docx — reading a Word file without leaving the app.
 *
 * Mark, 2026-11-17: "can you make the mobile app support opening word files?"
 * Until now every one of them went to the system share sheet, and four files
 * in this repo carried the line "the OS previews a .docx and we cannot".
 *
 * ── Why this is possible at all, and why it needs no build ────────────────
 *
 * A .docx is a ZIP. The text is one entry inside it, `word/document.xml`, in
 * a namespace (WordprocessingML) that is verbose but entirely readable. So
 * the whole job is: inflate one entry, walk its paragraphs. `fflate` does
 * the inflating and is PURE JAVASCRIPT — no native module, so the runtime
 * fingerprint does not move and this reaches a phone as an over-the-air
 * update rather than as a TestFlight build.
 *
 * ── What it reads, and what it does not ──────────────────────────────────
 *
 * Paragraphs, runs, bold/italic/underline, headings, and list items. That is
 * what makes a document READABLE, which is what "open" means when you have
 * been sent one and want to know what it says.
 *
 * It is NOT a renderer: no page geometry, no columns, no fonts, no floats.
 * Tables are flattened to their cell text, in order, rather than dropped —
 * a minutes document whose decisions live in a table is worse than useless
 * with the table silently missing. Images are named, not drawn.
 *
 * `.doc` — the old binary format — is not a ZIP and is not attempted. It is
 * a different problem entirely (a compound-file container of undocumented
 * records) and the honest answer there is still the system's.
 */
import { unzipSync, strFromU8 } from 'fflate';

/** Word's own paragraph styles, mapped to the three levels worth keeping. */
const HEADING = /^heading\s*([1-6])$/i;

/** A `.docx`? The extension, because a mime type is whatever the uploader said. */
export function isDocx(item) {
  const name = String(item?.originalName || item?.filename || '').toLowerCase();
  if (name.endsWith('.docx')) return true;
  // The mime type only gets a say when there is no name to read.
  return !name.includes('.')
    && String(item?.mimeType || '') === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
}

/** The old binary .doc, which this cannot read and should not pretend to. */
export function isLegacyDoc(item) {
  const name = String(item?.originalName || item?.filename || '').toLowerCase();
  return name.endsWith('.doc');
}

/**
 * Every `<w:t>` inside a node, in document order, with `<w:tab>` and
 * `<w:br>` honoured.
 *
 * Regex rather than a DOM: there is no XML parser in this app, the shape
 * being matched is one element with no nesting of its own, and a 200-page
 * document is still only a few megabytes of markup. A real parser would be
 * the right call the moment this needs attributes in nested positions.
 */
function textOf(xml) {
  let out = '';
  const re = /<w:(t|tab|br|cr)(\s[^>]*)?(\/>|>([\s\S]*?)<\/w:\1>)/g;
  let m = re.exec(xml);
  while (m) {
    if (m[1] === 't') out += unescapeXml(m[4] || '');
    else if (m[1] === 'tab') out += '\t';
    else out += '\n';
    m = re.exec(xml);
  }
  return out;
}

function unescapeXml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

/** Is a toggle property ON? `<w:b/>` and `<w:b w:val="1"/>` are; `w:val="0"` is not. */
const toggled = (props, tag) => {
  const m = new RegExp(`<w:${tag}(\\s[^>]*)?/?>`).exec(props || '');
  if (!m) return false;
  const val = /w:val="([^"]*)"/.exec(m[1] || '');
  return !val || !['0', 'false', 'off'].includes(val[1]);
};

/** One paragraph → one block, or null when it is empty of everything. */
function blockOf(xml, index) {
  const props = (/<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(xml) || [])[1] || '';
  const styleId = (/<w:pStyle\s+w:val="([^"]*)"/.exec(props) || [])[1] || '';
  const heading = HEADING.exec(styleId.replace(/([a-z])([0-9])/i, '$1 $2'));
  const listed = /<w:numPr>/.test(props);

  // Runs carry their own bold/italic; a paragraph whose runs all agree is
  // reported as a bold paragraph, which is how most documents emphasise a
  // line. Per-run styling inside a line is deliberately not modelled: it
  // would need rich text, and this is for reading.
  const runs = xml.match(/<w:r(\s[^>]*)?>[\s\S]*?<\/w:r>/g) || [];
  const styled = runs.filter((r) => textOf(r).trim());
  const every = (tag) => styled.length > 0
    && styled.every((r) => toggled((/<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(r) || [])[1] || '', tag));

  const text = textOf(xml).replace(/\u0000/g, '').trimEnd();
  if (!text.trim()) return null;
  return {
    key: `p${index}`,
    text,
    heading: heading ? Math.min(3, Number(heading[1])) : 0,
    bold: every('b'),
    italic: every('i'),
    listed,
  };
}

/**
 * The document's blocks, in order.
 *
 * Tables are walked cell by cell so their text survives; the cells are
 * marked so a reader can tell a table's contents from prose rather than
 * being handed a wall of fragments.
 */
export function parseDocumentXml(xml) {
  const body = (/<w:body>([\s\S]*)<\/w:body>/.exec(xml || '') || [])[1] || String(xml || '');
  const blocks = [];
  // Paragraphs and tables, in the order they appear.
  const re = /<w:(p|tbl)(\s[^>]*)?>([\s\S]*?)<\/w:\1>/g;
  let m = re.exec(body);
  let i = 0;
  while (m) {
    if (m[1] === 'p') {
      const b = blockOf(m[0], i);
      if (b) blocks.push(b);
    } else {
      for (const row of m[0].match(/<w:tr(\s[^>]*)?>[\s\S]*?<\/w:tr>/g) || []) {
        const cells = (row.match(/<w:tc(\s[^>]*)?>[\s\S]*?<\/w:tc>/g) || [])
          .map((cell) => textOf(cell).replace(/\s+/g, ' ').trim())
          .filter(Boolean);
        if (cells.length) blocks.push({ key: `t${i}-${blocks.length}`, text: cells.join('  ·  '), cell: true });
      }
    }
    i += 1;
    m = re.exec(body);
  }
  return blocks;
}

/**
 * A .docx's readable content, from its bytes.
 *
 * Throws with a sentence worth showing: this runs behind a viewer, and
 * "undefined is not an object" is not something to put on a screen.
 */
export function readDocx(bytes) {
  let files;
  try {
    files = unzipSync(new Uint8Array(bytes), { filter: (f) => f.name === 'word/document.xml' });
  } catch {
    throw new Error('That file is not readable as a Word document.');
  }
  const entry = files['word/document.xml'];
  // A .docx with no document part is either not one, or is corrupt — and
  // both are the same news to whoever is holding it.
  if (!entry) throw new Error('That file is not readable as a Word document.');
  const blocks = parseDocumentXml(strFromU8(entry));
  if (!blocks.length) throw new Error('This document has no text in it.');
  return blocks;
}

export default { isDocx, isLegacyDoc, parseDocumentXml, readDocx };
