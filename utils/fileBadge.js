/**
 * What to call a file when all you have is its name.
 *
 * "PDF", "XLS", "ZIP" — the short word that goes on a tile, a card or an icon
 * when there is no picture to show, plus the two questions that decide WHICH
 * of those a canvas item becomes: is it a PDF (we can draw the page), and is
 * it something the pond will hand us a picture of at all.
 *
 * This is the phone's half of `web-app/src/utils/fileBadge.ts` — same badges,
 * same stems, so a file placed on a canvas reads the same on both. The two
 * predicates below are the canvas's, and the web keeps its own copies in
 * CanvasBoardScreen/pdfPages; see the note on PICTURE_EXTS for the one place
 * they deliberately disagree.
 */

export const extensionOfName = (name) => {
  // A URL-ish name ("Lease.pdf?v=2") would otherwise take the query string as
  // its extension — the same guard filesUtils.isPdf has always had.
  const clean = String(name || '').trim().split(/[?#]/, 1)[0];
  const i = clean.lastIndexOf('.');
  return i > 0 ? clean.slice(i + 1).toLowerCase() : '';
};

/**
 * Extensions the pond serves a resized PICTURE for.
 *
 * This is NOT a guess and it is not the web's list: it is exactly the
 * `imageExts` that `getFileType` (server/routes/media.js) stores as
 * `type: 'image'`, because `/api/media/preview|display/:id` refuses anything
 * else with a 400 ("variant only supported for images"). So this answers the
 * only question the caller actually has — will an <Image> pointed at the
 * variant endpoint ever paint — and anything outside it gets a card instead
 * of the blank frame a 400 leaves behind.
 *
 * The web's copy of this list also contains the video extensions, on the
 * grounds that a video has a poster frame. It does, but not at the variant
 * endpoint — that 400s for a video too, and says so in its own hint. Keeping
 * them out here is why a video on a canvas shows up as a card on the phone
 * rather than as nothing at all.
 */
export const PICTURE_EXTS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'heic', 'heif',
]);

/**
 * Do we KNOW this is not a picture — i.e. is a card the honest answer?
 *
 * Note the asymmetry: a name with NO extension to judge by is treated as a
 * picture and tried at the variant endpoint anyway. The two ways of being
 * wrong are not equal. Guess "card" on a photo whose label was never cached
 * and the card HIDES it, with nothing to say a picture is underneath; guess
 * "picture" on a document and the worst case is the blank frame that is
 * already there today. So the card is only ever drawn on positive evidence.
 * (The web's copy of this decides the other way and cards an unlabelled item.)
 */
export const isKnownNonPicture = (name) => {
  const ext = extensionOfName(name);
  return !!ext && !PICTURE_EXTS.has(ext);
};

/** Is this item backed by a PDF — the one document we can draw ourselves? */
export const isPdfName = (name) => extensionOfName(name) === 'pdf';

/** The families worth a word of their own; everything else wears its own
 *  extension, which is more use than a generic "FILE". */
const BADGES = {
  pdf: 'PDF', doc: 'DOC', docx: 'DOC', rtf: 'DOC', odt: 'DOC',
  xls: 'XLS', xlsx: 'XLS', ods: 'XLS', csv: 'CSV',
  ppt: 'PPT', pptx: 'PPT', odp: 'PPT',
  txt: 'TXT', md: 'MD', json: 'JSON', zip: 'ZIP',
};

/**
 * The badge for a bare filename. Capped at five characters so a long, unknown
 * extension cannot push a card's layout around.
 */
export function fileBadge(name) {
  const ext = extensionOfName(name);
  if (!ext) return 'FILE';
  return BADGES[ext] || ext.toUpperCase().slice(0, 5);
}

/** The name without its extension — a card shows the two separately. */
export function fileStem(name) {
  const clean = String(name || '').trim();
  const i = clean.lastIndexOf('.');
  return i > 0 ? clean.slice(0, i) : clean;
}

/** MaterialCommunityIcons, by format. The vault's document language, shared
 *  so the canvas calls a spreadsheet what the Files tab calls it. */
const EXT_ICON = {
  pdf: 'file-pdf-box',
  doc: 'file-word-box', docx: 'file-word-box', odt: 'file-word-box', rtf: 'file-word-box',
  xls: 'file-excel-box', xlsx: 'file-excel-box', ods: 'file-excel-box', csv: 'file-delimited-outline',
  ppt: 'file-powerpoint-box', pptx: 'file-powerpoint-box', odp: 'file-powerpoint-box',
  zip: 'folder-zip-outline',
  json: 'code-json',
  md: 'language-markdown',
  txt: 'file-document-outline',
};

/** The icon for a bare filename. */
export const fileIconForName = (name) => EXT_ICON[extensionOfName(name)] || 'file-outline';
