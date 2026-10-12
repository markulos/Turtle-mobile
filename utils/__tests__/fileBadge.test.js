/**
 * fileBadge — the questions asked of a bare filename.
 *
 * The two predicates are the load-bearing ones: they decide whether a canvas
 * item is drawn as a page, as a picture, or as a card, and the bug they exist
 * to prevent is a blank frame (the variant endpoint 400s for anything that is
 * not an image, and an <Image> pointed at a 400 paints nothing at all).
 */
import {
  PICTURE_EXTS, extensionOfName, fileBadge, fileIconForName, fileStem,
  isKnownNonPicture, isPdfName,
} from '../fileBadge';

describe('extensionOfName', () => {
  it('takes the last extension, lower-cased', () => {
    expect(extensionOfName('Lease.PDF')).toBe('pdf');
    expect(extensionOfName('2026.09.report.final.docx')).toBe('docx');
  });

  it('is empty for a name with no extension, and for a dotfile', () => {
    expect(extensionOfName('Scan')).toBe('');
    // A leading dot is the whole name, not an extension — `lastIndexOf > 0`.
    expect(extensionOfName('.gitignore')).toBe('');
    expect(extensionOfName('')).toBe('');
    expect(extensionOfName(null)).toBe('');
  });

  it('ignores a query string, the way a URL-ish name arrives', () => {
    expect(extensionOfName('plan.pdf?v=2')).toBe('pdf');
    expect(extensionOfName('plan.pdf#page=3')).toBe('pdf');
  });
});

describe('isPdfName', () => {
  it('is true for a PDF whatever the case, false for a look-alike', () => {
    expect(isPdfName('261009_SMSD_DRAFT_GF.pdf')).toBe(true);
    expect(isPdfName('deck.PDF')).toBe(true);
    // Not a PDF: the extension is what counts, not the word appearing in it.
    expect(isPdfName('pdf-notes.txt')).toBe(false);
    expect(isPdfName('my.pdf.zip')).toBe(false);
    expect(isPdfName('')).toBe(false);
  });
});

describe('isKnownNonPicture', () => {
  it('is false for everything the variant endpoint actually serves', () => {
    for (const ext of ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'heic', 'heif']) {
      expect(isKnownNonPicture(`photo.${ext}`)).toBe(false);
    }
  });

  /**
   * The whole point of the list. Each of these is stored by the server as
   * something other than `type: 'image'`, so /api/media/preview answers 400
   * and the item has to become a card instead of a blank frame.
   */
  it('is true for documents, archives and VIDEO', () => {
    expect(isKnownNonPicture('lease.pdf')).toBe(true);
    expect(isKnownNonPicture('budget.xlsx')).toBe(true);
    expect(isKnownNonPicture('assets.zip')).toBe(true);
    // Video has a poster frame, but NOT at the variant endpoint — that 400s
    // for a video too and says so in its own hint. The web's copy of this
    // list gets this wrong; see the note in fileBadge.js.
    expect(isKnownNonPicture('walkthrough.mp4')).toBe(true);
    expect(isKnownNonPicture('clip.mov')).toBe(true);
  });

  /**
   * The asymmetry, pinned: with no extension to judge by we try the picture.
   * A card drawn over a photo whose label was never cached HIDES it; an
   * <Image> that 400s is the blank frame that is already there. So the card
   * needs positive evidence, and this is the case that must not regress.
   */
  it('is FALSE for a name with no extension — the picture still gets its try', () => {
    expect(isKnownNonPicture('Pasted 2026-10-09')).toBe(false);
    expect(isKnownNonPicture('')).toBe(false);
    expect(isKnownNonPicture(null)).toBe(false);
  });

  it('carries no video extensions at all', () => {
    for (const ext of ['mp4', 'mov', 'webm', 'm4v']) {
      expect(PICTURE_EXTS.has(ext)).toBe(false);
    }
  });
});

describe('fileBadge and fileStem', () => {
  it('names the families, and falls back to the extension itself', () => {
    expect(fileBadge('lease.pdf')).toBe('PDF');
    expect(fileBadge('notes.docx')).toBe('DOC');
    expect(fileBadge('budget.xlsx')).toBe('XLS');
    expect(fileBadge('data.parquet')).toBe('PARQU');
    expect(fileBadge('Scan')).toBe('FILE');
  });

  it('caps an unknown extension so a card cannot be pushed about', () => {
    expect(fileBadge('x.superlongextension').length).toBe(5);
  });

  it('strips the extension for the name on the card', () => {
    expect(fileStem('261009_SMSD_DRAFT_GF.pdf')).toBe('261009_SMSD_DRAFT_GF');
    expect(fileStem('Scan')).toBe('Scan');
  });
});

describe('fileIconForName', () => {
  it('gives the vault its format icons, and a generic one otherwise', () => {
    expect(fileIconForName('lease.pdf')).toBe('file-pdf-box');
    expect(fileIconForName('notes.docx')).toBe('file-word-box');
    expect(fileIconForName('data.parquet')).toBe('file-outline');
    expect(fileIconForName('')).toBe('file-outline');
  });
});
