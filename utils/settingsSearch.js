/**
 * Matching for the Settings search field.
 *
 * Kept as pure functions, separate from the screen, because this is the part
 * with actual behaviour worth testing — the screen around it is layout.
 *
 * The rule: EVERY token the user typed has to match somewhere in a setting's
 * terms. That makes typing more words narrow the result rather than widen it,
 * which is what people expect from a search box (and the opposite of an OR
 * match, where "dark cache" would show both dark mode and the cache row).
 *
 * A token matches when it is a substring of the terms, OR when it is within one
 * edit of some word in the terms. The edit-distance pass is what makes the
 * field forgiving of "notifcations" and "chache" — typos that are otherwise
 * indistinguishable from "no results", which reads as a broken search box.
 */

/** Lowercase, strip accents, and reduce punctuation to spaces. */
export function normalize(input) {
  return String(input == null ? '' : input)
    .toLowerCase()
    .normalize('NFD')
    // Combining marks — "café" and "cafe" must be the same word.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Query split into the tokens that must ALL match. */
export function tokenize(query) {
  const n = normalize(query);
  return n ? n.split(' ') : [];
}

/**
 * True when `a` and `b` are within one insert/delete/substitute.
 *
 * Bounded at one edit on purpose: two edits on short words starts matching
 * unrelated settings ("cache" ↔ "calendar" is closer than it looks once you
 * allow enough slack), and a wrong result is worse than no result.
 */
export function withinOneEdit(a, b) {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  // Substitution: same length, allow exactly one mismatch.
  if (la === lb) {
    let diff = 0;
    for (let i = 0; i < la; i++) {
      if (a[i] !== b[i] && ++diff > 1) return false;
    }
    return diff === 1;
  }
  // Insert/delete: walk both, permitting a single skip in the longer one.
  const [short, long] = la < lb ? [a, b] : [b, a];
  let i = 0, j = 0, skipped = false;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) { i++; j++; continue; }
    if (skipped) return false;
    skipped = true;
    j++;
  }
  return true;
}

/**
 * Does one query token match this setting's terms?
 *
 * Single-character tokens are substring-only: at one character every word is
 * within one edit of every other, so fuzzy matching there returns the whole
 * settings list and looks broken.
 */
export function tokenMatches(token, normalizedTerms, termWords) {
  if (!token) return true;
  if (normalizedTerms.includes(token)) return true;
  if (token.length < 4) return false;
  for (const w of termWords) {
    if (withinOneEdit(token, w)) return true;
    // Also forgive a typo in what the user typed as a PREFIX of a longer word
    // ("notifcation" against "notifications"), which the whole-word compare
    // above would miss.
    //
    // Both window sizes are needed. A substitution keeps the length, so it
    // lines up against a prefix of the same length; a DELETION shifts every
    // later character, so it only lines up against a prefix one longer. With
    // just the first window, "notifcation" (a dropped 'i') never matches.
    if (w.length > token.length) {
      if (withinOneEdit(token, w.slice(0, token.length))) return true;
      if (withinOneEdit(token, w.slice(0, token.length + 1))) return true;
    }
  }
  return false;
}

/**
 * True when a setting described by `terms` should stay visible for `query`.
 * An empty query matches everything — the caller uses that for the normal,
 * unfiltered screen.
 */
export function matchesQuery(query, terms) {
  const tokens = tokenize(query);
  if (tokens.length === 0) return true;
  const normalizedTerms = normalize(terms);
  if (!normalizedTerms) return false;
  const termWords = normalizedTerms.split(' ');
  for (const t of tokens) {
    if (!tokenMatches(t, normalizedTerms, termWords)) return false;
  }
  return true;
}
