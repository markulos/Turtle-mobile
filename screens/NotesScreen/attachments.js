/**
 * Note attachments — the pure half.
 *
 * Lives outside NoteAttachments.jsx for the same reason feedbackFilter.js lives
 * outside index.jsx: the component imports expo-image and the contexts, so
 * testing these rules through it would mean stubbing the whole native graph.
 *
 * The model these encode: a saved note stores only `media_ids`. Rendering them
 * needs a name and a thumbnail, which is what GET /media/by-ids answers with —
 * `{ id, type, mimeType, name, thumbnailUrl, thumbnailLgUrl }` per row, in the
 * order asked for, with unknown ids simply omitted.
 */

// Big thumbnail's display cap, in points. Matches the web strip's maxHeight:
// a note is a reading surface, so a tall screenshot gets scaled to fit rather
// than pushing the note's own text off the page.
export const MAX_IMAGE_H = 340;

// Fallback shape for an image whose intrinsic size hasn't loaded yet. 4:3 is
// the least-wrong guess for a camera roll photo, and the real ratio replaces it
// on the first onLoad — so this only governs the very first frame.
export const DEFAULT_RATIO = 4 / 3;

/**
 * Is this attachment a picture?
 *
 * `type` is the server's own classification and the primary signal; the mime
 * check is the fallback for a row typed before that column was filled in.
 * Same rule as the web strip's isImage, deliberately — the two surfaces must
 * not disagree about what counts as an image.
 */
export function isImage(m) {
  if (!m) return false;
  if (m.type === 'image') return true;
  if (m.type) return false; // typed as something else — trust it over the mime
  return String(m.mimeType || '').startsWith('image/');
}

/**
 * Split what came back into the two rows the strip renders.
 *
 * An image needs a thumbnail to be shown inline; one without (a row whose
 * thumbnail never generated) falls through to the chip row, where a filename
 * still tells you what it is.
 */
export function splitAttachments(items) {
  const images = [];
  const others = [];
  for (const m of items || []) {
    if (isImage(m) && (m.thumbnailLgUrl || m.thumbnailUrl)) images.push(m);
    else others.push(m);
  }
  return { images, others };
}

/** Absolute URL for a server-relative media path (`/api/media/...`). */
export function mediaUrl(origin, path) {
  if (!path) return null;
  return /^https?:/i.test(path) ? path : `${origin}${path}`;
}

/** What the strip shows inline — the large thumbnail, the small one if that's all there is. */
export function stripThumbUrl(origin, m) {
  return mediaUrl(origin, (m && (m.thumbnailLgUrl || m.thumbnailUrl)) || null);
}

/**
 * What the VIEWER shows — the display variant, keyed by media id.
 *
 * This is the whole reason the viewer needs nothing from the vault: /display/
 * is a standalone 1600px, aspect-preserving tier the server generates on
 * demand from the id alone. The vault's viewer resolves a gallery item first
 * (rawUrl, compressed layers, HD marks, offline copies); a note holds an id and
 * nothing else, so it addresses the image directly instead. The strip's own
 * thumbnail rides along as the placeholder, so the frame is never empty while
 * the big one generates — and as the fallback if it can't be (the route answers
 * 400 for non-images and 503 if sharp fails).
 */
export function viewerImageUrl(origin, m) {
  if (!m || !m.id) return null;
  return `${origin}/api/media/display/${encodeURIComponent(String(m.id))}`;
}

/**
 * The tappable list handed to the viewer — one entry per inline image, in strip
 * order, so the index the strip reports indexes this directly.
 */
export function viewerImages(origin, images) {
  return (images || []).map((m) => ({
    key: String(m.id),
    uri: viewerImageUrl(origin, m),
    previewUri: stripThumbUrl(origin, m),
    name: m.name || null,
  }));
}

/**
 * The line under the strip when the ids outnumber the rows that came back.
 *
 * The difference is files deleted from the vault — a note outlives its files —
 * so it says which, rather than letting "3 files" sit above two thumbnails and
 * read as a bug. Null when nothing is missing.
 */
export function missingLabel({ asked, got, failed }) {
  if (failed) return 'Could not load these right now.';
  const missing = asked - got;
  if (missing <= 0) return null;
  return `${missing} no longer in the vault.`;
}

/** "1 file" / "4 files". */
export function fileCountLabel(n) {
  return n === 1 ? '1 file' : `${n} files`;
}

// ── The list's thumbnails ───────────────────────────────────────────────────
//
// The strip above resolves ONE note, on open. The timeline needs the same
// answer for every note on screen while it is being flung — which is the one
// thing you cannot do per row: sixty rows mounting sixty requests during a
// scroll is exactly the stall the user would blame the scroll for. So the
// screen resolves the whole loaded page's ids in a couple of batched calls and
// hands each row a URL it already has.

/** The server's own cap on GET /media/by-ids — asking for more is a 400. */
export const BY_IDS_MAX = 200;

/**
 * Every media id the loaded notes point at that isn't accounted for yet, in
 * the order the notes appear — so the ids for the rows nearest the top of the
 * list land in the first batch.
 *
 * `known` is "already asked about", NOT "already answered": an id whose media
 * was deleted never comes back, and re-asking for it on every page load would
 * be a request per scroll that can only ever fail.
 */
export function collectMediaIds(notes, known) {
  const out = [];
  const seen = new Set();
  for (const n of notes || []) {
    const ids = Array.isArray(n?.mediaIds) ? n.mediaIds : [];
    for (const raw of ids) {
      const id = raw ? String(raw) : '';
      if (!id || seen.has(id) || known?.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Split a want-list into requests the server will accept. */
export function chunkIds(ids, size = BY_IDS_MAX) {
  const n = Math.max(1, size);
  const out = [];
  for (let i = 0; i < (ids?.length || 0); i += n) out.push(ids.slice(i, i + n));
  return out;
}

/**
 * What a TIMELINE row shows for its attachments: the first attached picture,
 * and how many files the note carries in total.
 *
 * The first image wins rather than the first attachment — a note whose first
 * file is a PDF and whose second is a screenshot should still show the
 * screenshot, because the picture is the thing you recognise the note by while
 * scrolling past it.
 *
 * `uri` is null in two different situations, and the row treats them the same:
 * nothing has resolved yet, and nothing viewable ever will (a note carrying
 * only documents). Both show the count badge, which is the honest answer —
 * "this note has files" — and the picture replaces it if one arrives.
 * Returns null for a note with no attachments at all, so an ordinary note pays
 * nothing for this.
 */
export function rowThumb(origin, note, resolved) {
  const ids = (Array.isArray(note?.mediaIds) ? note.mediaIds : []).filter(Boolean);
  if (ids.length === 0) return null;
  let uri = null;
  for (const id of ids) {
    const m = resolved && typeof resolved.get === 'function' ? resolved.get(String(id)) : null;
    if (!m || !isImage(m)) continue;
    const thumb = stripThumbUrl(origin, m);
    if (thumb) { uri = thumb; break; }
  }
  return { uri, count: ids.length };
}
