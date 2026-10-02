/**
 * Note attachments — the pure half, and the NOTE-specific half of it.
 *
 * Lives outside NoteAttachments.jsx for the same reason feedbackFilter.js lives
 * outside index.jsx: the component imports expo-image and the contexts, so
 * testing these rules through it would mean stubbing the whole native graph.
 *
 * What a `/media/by-ids` row IS, and which of them can be drawn, is not
 * note-specific — the friends thread asks the same questions — so that half lives
 * in utils/mediaAttachments. Callers import it from there directly; this module
 * does not pass it through.
 */
import { isImage, stripThumbUrl } from '../../utils/mediaAttachments';

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
// The strip resolves ONE note, on open. The timeline needs the same answer for
// every note on screen while it is being flung — which is the one thing you
// cannot do per row: sixty rows mounting sixty requests during a scroll is
// exactly the stall the user would blame the scroll for. So the screen resolves
// the whole loaded page's ids in a couple of batched calls and hands each row a
// URL it already has.

/**
 * Every media id the loaded notes point at that isn't accounted for yet, in the
 * order the notes appear — so the ids for the rows nearest the top of the list
 * land in the first batch.
 *
 * `known` is "already asked about", NOT "already answered": an id whose media
 * was deleted never comes back, and re-asking for it on every page load would be
 * a request per scroll that can only ever fail.
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

/**
 * What a TIMELINE row shows for its attachments: the first attached picture, and
 * how many files the note carries in total.
 *
 * The first image wins rather than the first attachment — a note whose first file
 * is a PDF and whose second is a screenshot should still show the screenshot,
 * because the picture is the thing you recognise the note by while scrolling past
 * it.
 *
 * `uri` is null in two different situations, and the row treats them the same:
 * nothing has resolved yet, and nothing viewable ever will (a note carrying only
 * documents). Both show the count badge, which is the honest answer — "this note
 * has files" — and the picture replaces it if one arrives. Returns null for a
 * note with no attachments at all, so an ordinary note pays nothing for this.
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
