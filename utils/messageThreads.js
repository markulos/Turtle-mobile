/**
 * The inbox: every conversation you have, newest first.
 *
 * ─── Why this exists at all ────────────────────────────────────────────────
 *
 * The phone could open a THREAD and had no way to find one. A direct message
 * was reachable from exactly two places — a tap on a push notification, and a
 * row of the Friends LEADERBOARD, which is a scoreboard that happens to list
 * people. If nobody had messaged you recently there was no door at all, and
 * "who has written to me" was a question the app could not answer.
 *
 * `GET /api/messages` has answered it the whole time: one grouped query giving
 * the last message of every conversation and how many of them are unread
 * (routes/messages.js). Nothing in the app called it. This is the shape that
 * call comes back in, kept pure so the page that draws it can be tested
 * without a server and so the badge and the list cannot disagree about what
 * "unread" means.
 */

/** Milliseconds, from whatever the row carries. 0 when there is nothing. */
function stamp(v) {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * `{ threads, unreadTotal }` → rows the list can draw, newest conversation
 * first.
 *
 * `people` is the pond roster (utils/usePondPeople), used ONLY to improve a
 * name the server did not have — never to decide who is in the list. A
 * conversation you have had is a conversation you have had, whether or not the
 * roster has caught up with the person in it.
 */
export function threadRows(payload, people) {
  const list = Array.isArray(payload?.threads) ? payload.threads : [];
  return list
    .map((t) => {
      const userId = t?.withUserId == null ? null : String(t.withUserId);
      if (!userId) return null;
      const known = people?.get?.(userId) || null;
      return {
        userId,
        name: t.withName || known?.name || 'Someone',
        avatarUrl: known?.avatarUrl || null,
        unread: Math.max(0, Number(t.unread) || 0),
        last: t.last || null,
        at: stamp(t.last?.createdAt),
      };
    })
    .filter(Boolean)
    // The server already orders these, but a list that depends on the
    // server's ORDER BY for its own correctness breaks silently the day
    // somebody adds a column to that query.
    .sort((a, b) => b.at - a.at);
}

/**
 * How many are waiting, across everything.
 *
 * Counted off the ROWS rather than trusting `unreadTotal`, so the badge can
 * never say 3 over a list that shows 2 — the two numbers come from the same
 * place or they will eventually disagree.
 */
export function unreadCount(rows) {
  return (rows || []).reduce((n, r) => n + (r?.unread || 0), 0);
}

/** "2 unread" for a card's subtitle, or the resting line when there are none. */
export function unreadLabel(n, { idle = 'Your conversations' } = {}) {
  const count = Math.max(0, Number(n) || 0);
  if (count === 0) return idle;
  return count === 1 ? '1 unread' : `${count} unread`;
}

/**
 * The badge's own text. Capped, because a circle sized for two digits that is
 * handed three stops being a circle — and past a hundred the exact number has
 * stopped being the point.
 */
export function badgeText(n) {
  const count = Math.max(0, Number(n) || 0);
  if (count <= 0) return '';
  return count > 99 ? '99+' : String(count);
}

/**
 * `Today` / `Yesterday` / `12 Mar` — WHEN a conversation last moved.
 *
 * Deliberately a day and not a clock time: an inbox is read as "how long has
 * this been sitting there", and `3:42 pm` on a row from last week answers the
 * wrong question. (The THREAD uses clock times — see friendMessages.timeLabel
 * — because within one conversation the day is already settled.)
 */
export function threadWhen(at, { now = Date.now(), locale } = {}) {
  const ms = stamp(at);
  if (!ms) return '';
  const d = new Date(ms);
  const today = new Date(now);
  const sameDay = (x, y) => x.getFullYear() === y.getFullYear()
    && x.getMonth() === y.getMonth()
    && x.getDate() === y.getDate();
  if (sameDay(d, today)) {
    return d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  }
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(d, yesterday)) return 'Yesterday';
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString(locale, sameYear
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
}
