/**
 * What `GET /media/by-ids` hands back, and the questions every caller asks of it.
 *
 * Anything that stores media ids — a note, a direct message — holds ONLY ids.
 * Rendering it means asking the vault for a name and a thumbnail, which is what
 * that endpoint answers with: `{ id, type, mimeType, name, thumbnailUrl,
 * thumbnailLgUrl }` per row, in the order asked for, with unknown ids simply
 * omitted.
 *
 * These rules were written for notes first and then wanted verbatim by the
 * friends thread, so they live here rather than in either feature. Pure — no
 * expo-image, no contexts — so they test without stubbing the native graph.
 */

// Big thumbnail's display cap, in points. Matches the web strip's maxHeight: a
// reading surface scales a tall screenshot to fit rather than letting it push
// the text off the page.
export const MAX_IMAGE_H = 340;

// Fallback shape for an image whose intrinsic size hasn't loaded yet. 4:3 is the
// least-wrong guess for a camera roll photo, and the real ratio replaces it on
// the first onLoad — so this only governs the very first frame.
export const DEFAULT_RATIO = 4 / 3;

/** The server's own cap on GET /media/by-ids — asking for more is a 400. */
export const BY_IDS_MAX = 200;

/**
 * Is this attachment a picture?
 *
 * `type` is the server's own classification and the primary signal; the mime
 * check is the fallback for a row typed before that column was filled in. The
 * same rule as the web app's isImage, deliberately — the two surfaces must not
 * disagree about what counts as an image.
 */
export function isImage(m) {
  if (!m) return false;
  if (m.type === 'image') return true;
  if (m.type) return false; // typed as something else — trust it over the mime
  return String(m.mimeType || '').startsWith('image/');
}

/**
 * Split what came back into the two rows a strip renders.
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

/** What a strip shows inline — the large thumbnail, the small one if that's all there is. */
export function stripThumbUrl(origin, m) {
  return mediaUrl(origin, (m && (m.thumbnailLgUrl || m.thumbnailUrl)) || null);
}

/**
 * What the VIEWER shows — the display variant, keyed by media id.
 *
 * This is the whole reason the viewer needs nothing from the vault: /display/ is
 * a standalone 1600px, aspect-preserving tier the server generates on demand
 * from the id alone. The vault's own viewer resolves a gallery item first
 * (rawUrl, compressed layers, HD marks, offline copies); a note or a message
 * holds an id and nothing else, so it addresses the image directly instead. The
 * strip's thumbnail rides along as the placeholder, so the frame is never empty
 * while the big one generates — and as the fallback if it can't be (the route
 * answers 400 for non-images and 503 if sharp fails).
 */
export function viewerImageUrl(origin, m) {
  if (!m || !m.id) return null;
  return `${origin}/api/media/display/${encodeURIComponent(String(m.id))}`;
}

/**
 * The tappable list handed to the viewer — one entry per inline image, in the
 * order they are shown, so the index a strip reports indexes this directly.
 */
export function viewerImages(origin, images) {
  return (images || []).map((m) => ({
    key: String(m.id),
    uri: viewerImageUrl(origin, m),
    previewUri: stripThumbUrl(origin, m),
    name: m.name || null,
  }));
}

/** Split a want-list into requests the server will accept. */
export function chunkIds(ids, size = BY_IDS_MAX) {
  const n = Math.max(1, size);
  const out = [];
  for (let i = 0; i < (ids?.length || 0); i += n) out.push(ids.slice(i, i + n));
  return out;
}
