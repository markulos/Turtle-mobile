/**
 * Playback ↔ transcript sync: which turn and which word are being spoken at a
 * given position, the shape a result is read into, and where to scroll so the
 * live turn stays in view.
 *
 * Pure and free of react-native imports, like `transcriptionProgress` and
 * `transcriptionOptions` beside it: this arithmetic runs four times a second
 * under the reader and has to be provable without a renderer.
 *
 * ─── The lead ───────────────────────────────────────────────────────────────
 *
 * The reader asks "what is playing at P" from a progress report that is up to
 * one polling interval stale, and the eye forgives a word lighting a fraction
 * EARLY far more readily than one lighting after it was heard. So the lookup
 * runs `LEAD_SECONDS` ahead of the reported position: the highlight arrives
 * with the sound rather than trailing it.
 *
 * ─── Sticky ─────────────────────────────────────────────────────────────────
 *
 * Words have gaps between them — breaths, pauses, punctuation the aligner
 * dropped — and turns have gaps between them too. A highlight that went dark
 * in every gap would flicker like a bad connection, so between words the LAST
 * word stays lit and between turns the last turn stays lit. Only BEFORE the
 * first start is nothing lit: the silence at the top of a recording has no
 * word to point at.
 */
import { formatDuration } from './transcriptionOptions';

/** How far ahead of the reported position the highlight runs, in seconds. */
export const LEAD_SECONDS = 0.12;

/**
 * Where the active turn is kept, as a fraction of the viewport from the top.
 * A third of the way down leaves the lines just spoken visible above it and
 * most of the screen for what comes next, which is where the eye is going.
 */
export const FOLLOW_ANCHOR = 0.35;

// `Number(null)` is 0 and `Number('')` is 0 — both finite, neither a time.
// A word the aligner could not place arrives with `start: null`, and treating
// that as second zero would pin it to the top of the recording.
const finite = (value) => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * Index of the last item whose `start` is at or before `position + lead`, or
 * -1 when the position is before the first one.
 *
 * Binary search, so the items MUST be sorted by `start` ascending — which
 * `turnsFromResult` guarantees for turns and for each turn's words. A NaN
 * position (the player before it has loaded anything) is "before the first".
 */
function lastStartedIndex(items, position, lead) {
  if (!Array.isArray(items) || items.length === 0) return -1;
  const at = finite(position);
  if (at === null) return -1;
  const target = at + lead;
  let low = 0;
  let high = items.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const start = finite(items[mid]?.start);
    if (start !== null && start <= target) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/** The turn being spoken at `position`, or -1 before the first turn starts. */
export function activeTurnIndex(turns, position, { lead = LEAD_SECONDS } = {}) {
  return lastStartedIndex(turns, position, lead);
}

/** The word being spoken at `position`, or -1 before the first word starts. */
export function activeWordIndex(words, position, { lead = LEAD_SECONDS } = {}) {
  return lastStartedIndex(words, position, lead);
}

/**
 * A turn's aligned words, as the reader renders them.
 *
 * The wire only carries words that HAVE timings (the server drops the rest),
 * but the wire is not ours to trust: anything without a finite start and end
 * is dropped here too, because a word the highlight cannot reach is a word
 * that would sit dark for ever in the middle of a lit line.
 */
function normaliseWords(raw) {
  if (!Array.isArray(raw)) return [];
  const words = [];
  for (const entry of raw) {
    const word = String(entry?.word ?? entry?.text ?? '').trim();
    const start = finite(entry?.start);
    const end = finite(entry?.end);
    if (!word || start === null || end === null) continue;
    const out = { word, start, end: Math.max(start, end) };
    const score = finite(entry?.score);
    if (score !== null) out.score = score;
    words.push(out);
  }
  // Array.prototype.sort is stable, so equal starts keep their wire order.
  words.sort((a, b) => a.start - b.start);
  return words;
}

/**
 * The result's turns in the one shape the reader and the sync functions
 * agree on: `{ speaker, start, end, text, words }`, sorted by start, `words`
 * always an array (an older pond sends none — the turn then highlights as a
 * block and the words simply do not light individually).
 *
 * A turn with no timing of its own has never been seen from WhisperX, but
 * the transcript text is the whole point and dropping it would be worse than
 * a mis-synced line: it takes its place after the previous turn instead.
 */
export function turnsFromResult(result) {
  const raw = Array.isArray(result?.turns) ? result.turns : [];
  const turns = [];
  let cursor = 0;
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const words = normaliseWords(entry.words);
    const text = String(entry.text ?? '').trim() || words.map((w) => w.word).join(' ');
    if (!text) continue;
    const start = finite(entry.start) ?? words[0]?.start ?? cursor;
    const end = Math.max(start, finite(entry.end) ?? words[words.length - 1]?.end ?? start);
    cursor = end;
    turns.push({
      speaker: String(entry.speaker ?? '').trim() || 'Speaker',
      start,
      end,
      text,
      words,
    });
  }
  turns.sort((a, b) => a.start - b.start);
  return turns;
}

/**
 * The scroll offset that puts an item's top `anchor` of the way down the
 * viewport, clamped to what the list can actually scroll to — the last turns
 * of a transcript cannot be lifted to a third of the way up, and asking for
 * it would bounce the list off its end.
 */
export function scrollTargetOffset({
  itemOffset, viewportHeight, contentHeight, anchor = FOLLOW_ANCHOR,
}) {
  const top = finite(itemOffset) ?? 0;
  const viewport = Math.max(0, finite(viewportHeight) ?? 0);
  const content = Math.max(0, finite(contentHeight) ?? 0);
  const maxOffset = Math.max(0, content - viewport);
  const wanted = top - viewport * anchor;
  return Math.min(maxOffset, Math.max(0, wanted));
}

/**
 * How many voices a result found. The route reports `detectedSpeakers` once
 * diarization ran; a job sent without it has one voice, which the turns'
 * own labels still tell us.
 */
export function voicesIn(result, turns) {
  const reported = finite(result?.detectedSpeakers);
  if (reported !== null && reported > 0) return Math.round(reported);
  if (Array.isArray(result?.speakers) && result.speakers.length) return result.speakers.length;
  const labels = new Set((Array.isArray(turns) ? turns : []).map((t) => t?.speaker).filter(Boolean));
  return labels.size;
}

/** The reader's header line: "2 voices · EN · 12:34", with whatever is known. */
export function summaryLine({ speakers, language, durationSeconds } = {}) {
  const voices = finite(speakers);
  return [
    voices !== null && voices > 0 ? `${voices} ${voices === 1 ? 'voice' : 'voices'}` : '',
    language ? String(language).trim().toUpperCase() : '',
    formatDuration(durationSeconds),
  ].filter(Boolean).join(' · ');
}
