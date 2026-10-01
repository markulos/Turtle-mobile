/**
 * friendMessages — the arithmetic behind a person-to-person thread.
 *
 * The pond's messaging is deliberately split: `POST /api/messages/:id` is the
 * delivery and the socket's `message:new` is only a PING that says "there is
 * traffic with this person", carrying no text (routes/messages.js explains
 * why — socket auth is in observe mode, so private content must not ride it).
 *
 * That split is what makes this module necessary. A sent message exists in
 * three states at once and they arrive out of order:
 *
 *   1. the optimistic bubble, drawn the instant Send is pressed
 *   2. the POST's reply, which carries the REAL row
 *   3. the refetch triggered by our own `message:new` ping
 *
 * (3) routinely beats (2) — the server pings both sides immediately after
 * responding, and a refetch is one hop while the POST reply is still settling.
 * So the thread must be able to recognise its own optimistic bubble in a server
 * row it has never seen the id of, or the sender watches their message appear
 * twice and then collapse into one. Matching on id alone cannot do that; this
 * module matches on what the two copies actually share.
 *
 * Pure on purpose: ordering and de-duplication are exactly the parts that look
 * fine in a demo and go wrong on a slow link, so they are testable without a
 * socket, a server or a rendered bubble.
 */

/**
 * How far apart a local bubble and its server row may be stamped and still be
 * the same message.
 *
 * The two clocks are different machines: `createdAt` on the local copy is the
 * phone's, and the server's is the pond's. A few seconds of drift between them
 * is ordinary and not worth a round of NTP, while two DISTINCT messages with
 * identical text inside the same few seconds means the sender double-tapped —
 * in which case collapsing them is also the kinder reading.
 */
export const ECHO_WINDOW_MS = 60_000;

/** Oldest first, with a stable tiebreak so equal stamps cannot swap on re-sort. */
export function byTime(a, b) {
  const t = (a?.createdAt || 0) - (b?.createdAt || 0);
  if (t !== 0) return t;
  return String(a?.id || '').localeCompare(String(b?.id || ''));
}

/**
 * Is `local` (an optimistic bubble) the same message as one already in
 * `serverRows`?
 *
 * Only ever compares against rows the server says are MINE — a friend echoing
 * your words back is a different message that happens to read the same, and
 * swallowing it would delete half a conversation.
 */
export function isEchoed(local, serverRows) {
  const text = String(local?.content ?? '').trim();
  if (!text) return false;
  return serverRows.some((row) => (
    row?.mine
    && String(row.content ?? '').trim() === text
    && Math.abs((row.createdAt || 0) - (local?.createdAt || 0)) <= ECHO_WINDOW_MS
  ));
}

/**
 * The thread as it should be drawn: everything the server knows, plus the
 * optimistic bubbles it has not caught up with yet.
 *
 * A FAILED bubble is always kept. It is the only record that the send did not
 * land — dropping it because a same-text row exists would quietly tell someone
 * their message got through when it did not.
 */
export function mergeThread(serverRows = [], locals = []) {
  const rows = Array.isArray(serverRows) ? serverRows.filter(Boolean) : [];
  const pending = (Array.isArray(locals) ? locals : [])
    .filter(Boolean)
    .filter((l) => l.failed || !isEchoed(l, rows));
  return [...rows, ...pending].sort(byTime);
}

/**
 * Build the optimistic bubble for text the user just sent.
 *
 * `localId` is its handle for the lifetime of the send — the one thing that
 * survives into the failed state, where there is no server id to key by.
 */
export function optimisticMessage(content, { now = Date.now(), seq = 0 } = {}) {
  return {
    id: `local-${now}-${seq}`,
    localId: `local-${now}-${seq}`,
    content: String(content ?? '').trim(),
    createdAt: now,
    mine: true,
    local: true,
    failed: false,
    readAt: null,
  };
}

/**
 * A short clock label for a bubble — `9:04 am`.
 *
 * Deliberately not relative ("2m ago"): a thread is read top to bottom and a
 * relative stamp on every row is a wall of numbers that all change while you
 * look at it.
 */
export function timeLabel(ts, { locale } = {}) {
  if (!ts && ts !== 0) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d
    .toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
    .toLowerCase();
}

/**
 * Should a date separator be drawn above `msg`?
 *
 * True for the first message of the thread and whenever the local day changes.
 * Local day, not UTC: a conversation that ran past midnight should break where
 * the people in it think it broke.
 */
export function startsNewDay(msg, previous) {
  if (!msg) return false;
  if (!previous) return true;
  const a = new Date(msg.createdAt || 0);
  const b = new Date(previous.createdAt || 0);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false;
  return a.getFullYear() !== b.getFullYear()
    || a.getMonth() !== b.getMonth()
    || a.getDate() !== b.getDate();
}

/** `Today` / `Yesterday` / `12 Mar` for a separator. */
export function dayLabel(ts, { now = Date.now(), locale } = {}) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date(now);
  const sameDay = (x, y) => x.getFullYear() === y.getFullYear()
    && x.getMonth() === y.getMonth()
    && x.getDate() === y.getDate();
  if (sameDay(d, today)) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}
