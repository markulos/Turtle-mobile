/**
 * Getting at the PDF renderer, safely — the one guard, shared.
 *
 * react-native-pdf is a NATIVE module, so it only exists in a binary that
 * bundled it. A top-level `import` of it would therefore take down the whole
 * runtime on an older build running this JS as an over-the-air update: the
 * import runs before any screen does, and there is nothing to catch it. So it
 * is required lazily and defensively (the pattern systemFilePick.js and
 * MediaGallery's react-native-share use), once, and the answer cached — a
 * failing `require` is not cheap and the answer cannot change while the app
 * is running.
 *
 * Two surfaces now ask: the vault's PdfViewer (the full reader) and the
 * canvas, which draws the page a board's PDF item is turned to. They share
 * this rather than each keeping their own copy, so there is one module cache
 * and one thing for a test to reset.
 *
 * Absent → each caller falls back on its own terms: the reader hands the
 * document to the system share sheet, the canvas draws a file card.
 */

let checked = false;
let renderer = null;

/** The `Pdf` component, or null in a binary without the native module. */
export function getPdfModule() {
  if (checked) return renderer;
  checked = true;
  try {
    const mod = require('react-native-pdf');
    renderer = mod?.default || mod || null;
  } catch {
    renderer = null;
  }
  return renderer;
}

/** Is there a renderer in this binary? Asked before routing to a reader. */
export function canRenderPdf() {
  return !!getPdfModule();
}

/** Tests mount these modules more than once with different module state. */
export function __resetPdfModuleForTests() {
  checked = false;
  renderer = null;
}
