/**
 * messageLinks — finding the link inside a message, and describing it.
 *
 * A message is plain text, so a URL someone sent is just characters in the
 * middle of a sentence. Two jobs follow:
 *
 *   1. SPLIT the text into prose and links, so a bubble can draw the links as
 *      pressable spans without changing a character of what was written.
 *   2. DESCRIBE the first link, by folding the pond's two link-preview shapes
 *      into one for the preview card.
 *
 * Only the FIRST link gets a card, which is what WhatsApp, iMessage and Signal
 * all do: a message with five links is a list, not five cards.
 *
 * ─── Why two server shapes ─────────────────────────────────────────────────
 * `GET /api/share/link-preview?url=` hands back the raw `link_previews` ROW
 * (snake_case, with a `status` that may be 'pending' or 'error') and never
 * fetches the page. `POST /api/share/preview` returns a FLATTENED camelCase
 * preview and WILL unfurl a URL nobody has shared before. A link typed into a
 * message is usually new, so the card needs both: the cheap read first, the
 * unfurling write only when that comes up empty. Hence two parsers.
 *
 * Pure on purpose — no react-native import — so the matching and the ordering
 * are testable without a renderer, and so this file can be read by the web
 * side's twin (`web-app/src/components/messages/messageLinks.ts`) without
 * either having to grow a shared package.
 *
 * ─── The regex, and what it deliberately does not do ───────────────────────
 * http(s) and `www.` only. No bare domains ("that was a big deal.com for us"
 * is prose), and no local paths — a message quoting `C:\turtle` is not
 * advertising a web page. No lookbehind anywhere: Hermes is the engine on the
 * phone and this is not the place to find out which assertions it supports.
 */

const URL_SOURCE = 'https?:\\/\\/[^\\s<>"\']+'
  + '|www\\.[\\w-]+(?:\\.[\\w-]+)+(?:\\/[^\\s<>"\']*)?';

/**
 * Sentence punctuation that ended up inside the match belongs to the sentence,
 * not to the address: "see https://x.com/page." links the page, not "page.".
 * Trimming afterwards rather than excluding it in the pattern keeps the regex
 * free of lookbehind (see above) — and the trimmed characters are handed back
 * to the surrounding prose, so the text still reads exactly as it was typed.
 */
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"»]+$/;

/** Prefix a scheme-less link with https:// so it can actually be opened. */
export function normalizeUrl(raw) {
  const t = String(raw ?? '').trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

/** Hostname without the `www.` prefix; '' for anything unparseable. */
export function hostOf(url) {
  const m = String(url ?? '').match(/^https?:\/\/([^/?#]+)/i);
  if (!m) return '';
  // Strip credentials and the port — neither belongs on the card's bottom line.
  return m[1].replace(/^[^@]*@/, '').replace(/:\d+$/, '').replace(/^www\./i, '');
}

/**
 * Split a message into segments: `{ text, url }`, where `url` is null for
 * prose. Concatenating every `text` reproduces the input EXACTLY — a renderer
 * that drops or adds a character would change what someone said.
 */
export function linkSegments(text) {
  const src = String(text ?? '');
  if (!src) return [];
  // A fresh RegExp per call: a module-level global one carries `lastIndex`
  // between bubbles, which goes wrong on the second message, not the first.
  const re = new RegExp(`(${URL_SOURCE})`, 'gi');
  const out = [];
  let last = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const clean = m[0].replace(TRAILING_PUNCTUATION, '');
    if (!clean) continue;
    if (m.index > last) out.push({ text: src.slice(last, m.index), url: null });
    out.push({ text: clean, url: normalizeUrl(clean) });
    // Only as far as the CLEAN match — whatever was trimmed off the end is
    // prose and is picked up by the next text segment.
    last = m.index + clean.length;
  }
  if (last < src.length) out.push({ text: src.slice(last), url: null });
  return out;
}

/** The first http(s) link in a message, or null. The one that gets a card. */
export function firstLinkUrl(text) {
  for (const seg of linkSegments(text)) {
    if (seg.url) return seg.url;
  }
  return null;
}

// ── The preview ──────────────────────────────────────────────────────────

/** True when a preview has enough on it to be worth a card at all. */
function isShowable(p) {
  // A card that is just the hostname tells the reader nothing the link text
  // already said, so it is not drawn. A thumbnail, a real title or a
  // description each earn one.
  return !!(p.thumbUrl || p.description || (p.title && p.title !== p.host));
}

const mediaTypeOf = (v) => (v === 'video' ? 'video' : 'link');

/**
 * Parse the cache-only GET's row. Returns null unless the row is a recorded
 * SUCCESS — 'pending' is an unfurl still in flight and 'error' is one worth
 * retrying, and in both cases the caller should go on to the POST.
 */
export function previewFromRow(url, row) {
  if (!row || row.status !== 'ok') return null;
  const host = hostOf(url);
  const preview = {
    url,
    host,
    title: String(row.title || row.site_name || host || url).trim(),
    description: String(row.description || '').trim(),
    thumbUrl: row.thumb_url || null,
    mediaType: mediaTypeOf(row.media_type),
  };
  return isShowable(preview) ? preview : null;
}

/**
 * Parse the unfurling POST's answer. A null preview there is a NORMAL outcome
 * (dead link, login wall, non-HTML) rather than an error — the message keeps
 * its pressable link and no card is drawn.
 */
export function previewFromFlat(url, flat) {
  if (!flat) return null;
  const host = flat.host || hostOf(url);
  const preview = {
    url,
    host,
    title: String(flat.title || flat.siteName || host || url).trim(),
    description: String(flat.description || '').trim(),
    thumbUrl: flat.thumbUrl || null,
    mediaType: mediaTypeOf(flat.mediaType),
  };
  return isShowable(preview) ? preview : null;
}

/** How long a "no preview" answer is trusted before the link is tried again. */
export const NEGATIVE_TTL_MS = 5 * 60 * 1000;

/**
 * Is a cached answer still good?
 *
 * A SUCCESS is kept for the whole session — an og:title does not change while
 * someone reads a thread, and re-asking per bubble would cost a round trip for
 * every scroll. A FAILURE expires, because the ordinary causes (the pond was
 * unreachable, the host rate-limited us, a transient 503) heal on their own,
 * and "fetched exactly once, ever" is the house bug this avoids.
 */
export function isFreshEntry(entry, now) {
  if (!entry) return false;
  if (entry.preview) return true;
  return now - entry.at < NEGATIVE_TTL_MS;
}
