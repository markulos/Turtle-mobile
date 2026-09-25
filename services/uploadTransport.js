/**
 * uploadTransport — which way a file goes to the pond: one multipart body, or
 * a series of parts (services/chunkedUpload). Pure; streamMultipartUpload
 * asks once per file, so the line is drawn in ONE place for every caller.
 *
 * WHY: "01BoulosMarkThesis2026 _final-revision-3.pdf", 184 MB, sent as one
 * body to https://app.t3d.ca/api/media/upload, stalled at exactly 4.0 MB on
 * every attempt across three days and ended in NSURLErrorDomain -1017 ("cannot
 * parse response"). app.t3d.ca is a Cloudflare tunnel, and the plan it is on
 * refuses a request body over 100 MB at the edge — the origin never sees the
 * request, the edge stops reading, and the phone's send buffer (4 MiB) sits
 * full until the watchdog gives up. No retry of the same body can succeed.
 * Parts of a few MB each cross the edge like any other request.
 *
 * The ceiling here is BELOW the edge's, with room for the multipart framing
 * and for whatever the edge counts that we do not. It is not lower than it
 * has to be: a single body keeps uploading on the background NSURLSession
 * after the app is suspended, while a chunked upload needs JavaScript awake
 * to send the next part. Ordinary photos and most phone videos stay on the
 * one-request path for that reason; only what would die at the edge goes in
 * parts.
 */

/** A single request body above this goes in parts. */
export const SINGLE_BODY_MAX_BYTES = 64 * 1024 * 1024;

const MEDIA_UPLOAD_URL = /\/media\/upload\/?(?:[?#].*)?$/;

/** Only the vault's ingest speaks the part/finish protocol. */
export function isMediaUploadUrl(url) {
  return MEDIA_UPLOAD_URL.test(String(url || ''));
}

/**
 * The base the chunked client builds `/media/upload/part` and `/finish` from:
 * everything before `/media/upload`, e.g. `https://pond/api`.
 */
export function chunkedBaseUrlOf(url) {
  return String(url || '').replace(MEDIA_UPLOAD_URL, '');
}

/**
 * @param {object} p
 * @param {string} p.url          the whole-file endpoint the caller would POST to
 * @param {number} [p.sizeBytes]  the file's size; unknown (0/null) → one body,
 *                                which is what has always happened
 * @param {string} [p.fieldName]  the multipart field; only the vault's `media`
 *                                has a chunked counterpart
 * @param {number} [p.singleBodyMaxBytes]
 * @returns {{ mode: 'single' } | { mode: 'chunked', baseUrl: string, sizeBytes: number }}
 */
export function chooseUploadTransport({
  url,
  sizeBytes = 0,
  fieldName = 'media',
  singleBodyMaxBytes = SINGLE_BODY_MAX_BYTES,
} = {}) {
  const size = Number(sizeBytes) || 0;
  if (fieldName !== 'media' || !isMediaUploadUrl(url)) return { mode: 'single' };
  if (size <= singleBodyMaxBytes) return { mode: 'single' };
  return { mode: 'chunked', baseUrl: chunkedBaseUrlOf(url), sizeBytes: size };
}
