/**
 * richText — the three edits the note composer's keys make, as pure text.
 *
 * Mark's to-do "Hyperlink in notes" (Turtle App · Mobile App): "make it
 * possible to have hyperlink in notes mobile and rich text."
 *
 * The RENDERING side needed nothing new — notes are drawn with the same
 * markdownLite + MarkdownText the chat has used all along. What was missing
 * was a way to WRITE it that does not require knowing Markdown: a bold key, an
 * italic key, and a link key. This is what those keys do to the string.
 *
 * ── Why the selection comes back out ─────────────────────────────────────
 *
 * Because a formatting key that leaves the caret somewhere arbitrary is a key
 * you use once. Wrapping a selection keeps it selected, so a second key
 * compounds (bold, then italic, on the same words). Inserting an empty pair
 * puts the caret BETWEEN the markers, so you just carry on typing. And the
 * link key selects the part you still have to fill in.
 *
 * Pure and here rather than in the screen so the arithmetic — which is all
 * off-by-one risk — can be tested without mounting a 4,000-line screen.
 */

/** A selection, normalised: never backwards, never outside the text. */
export function normalizeSelection(text, sel) {
  const len = String(text || '').length;
  const clamp = (n) => Math.max(0, Math.min(len, Math.floor(Number(n) || 0)));
  const a = clamp(sel?.start);
  // `?? a` is not enough: a missing `end` is `undefined`, and `Number(undefined)`
  // is NaN — which `??` passes straight through, and NaN selections put the
  // caret nowhere at all.
  const b = sel?.end == null ? a : clamp(sel.end);
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

/**
 * Put `marker` around the selection — or take it off again.
 *
 * A toggle, because that is what a bold key is: pressing it on text that is
 * already bold un-bolds it, and the alternative (`****bold****`) is not
 * something anybody meant.
 */
export function wrapSelection(text, sel, marker) {
  const src = String(text || '');
  const { start, end } = normalizeSelection(src, sel);
  const chosen = src.slice(start, end);
  const m = String(marker || '');
  if (!m) return { text: src, selection: { start, end } };

  // Already wrapped, inside the selection → unwrap it.
  if (chosen.length >= m.length * 2 && chosen.startsWith(m) && chosen.endsWith(m)) {
    const inner = chosen.slice(m.length, chosen.length - m.length);
    return {
      text: src.slice(0, start) + inner + src.slice(end),
      selection: { start, end: start + inner.length },
    };
  }
  // …or wrapped just OUTSIDE it, which is what you get when the key is
  // pressed a second time on a selection made by the first press.
  const before = src.slice(Math.max(0, start - m.length), start);
  const after = src.slice(end, end + m.length);
  if (before === m && after === m) {
    return {
      text: src.slice(0, start - m.length) + chosen + src.slice(end + m.length),
      selection: { start: start - m.length, end: start - m.length + chosen.length },
    };
  }

  const next = `${src.slice(0, start)}${m}${chosen}${m}${src.slice(end)}`;
  return {
    // Nothing selected → the caret lands between the markers, ready to type.
    // Something selected → it STAYS selected, so a second key compounds.
    selection: chosen
      ? { start: start + m.length, end: start + m.length + chosen.length }
      : { start: start + m.length, end: start + m.length },
    text: next,
  };
}

/** Does this look like something worth putting in a link? */
export function isUrlish(value) {
  const v = String(value || '').trim();
  if (!v || /\s/.test(v)) return false;
  return /^https?:\/\/\S+$/i.test(v) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v);
}

/** …and the form it goes in as. A bare host gets a scheme; it is a link. */
export function normalizeUrl(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

export const URL_PLACEHOLDER = 'https://';

/**
 * `[label](url)` around the selection.
 *
 * Four cases, and the selection that comes back is what makes each of them
 * one gesture rather than two:
 *
 *   · text selected, a url to hand  → done; the whole link is selected.
 *   · text selected, no url         → the URL part is selected, so the next
 *                                     thing you type (or paste) replaces it.
 *   · nothing selected, a url       → the LABEL is selected and empty, so you
 *                                     type the words and the link is made.
 *   · nothing selected, no url      → label first, same as above; the url is
 *                                     left as the placeholder to come back to.
 */
export function insertLink(text, sel, url) {
  const src = String(text || '');
  const { start, end } = normalizeSelection(src, sel);
  const label = src.slice(start, end);
  const href = url ? normalizeUrl(url) : URL_PLACEHOLDER;
  const next = `${src.slice(0, start)}[${label}](${href})${src.slice(end)}`;

  // Where the two halves sit in what we just built.
  const labelAt = start + 1;
  const urlAt = labelAt + label.length + 2;
  const selection = label
    ? (url
      ? { start, end: start + label.length + href.length + 4 }
      : { start: urlAt, end: urlAt + href.length })
    : { start: labelAt, end: labelAt };

  return { text: next, selection };
}

export default {
  URL_PLACEHOLDER, insertLink, isUrlish, normalizeSelection, normalizeUrl, wrapSelection,
};
