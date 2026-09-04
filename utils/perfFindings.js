/**
 * Turning perf telemetry back into English.
 *
 * `services/perfTelemetry.js` records keys, not sentences: `cold_start`,
 * `js_stall`, `api:/api/media/:x/tags`. The server ranks those by how much
 * user-felt time each one burned and hands the list back. What it CANNOT do is
 * say what any of them means to the person reading — that is this file.
 *
 * Kept free of react-native imports, same rule as `statsFormat` and `zoomMath`:
 * plain, side-effect-free, unit-testable without rendering anything.
 *
 * ─── Two decisions worth defending ──────────────────────────────────────────
 *
 * ROUTE KEYS ARE NOT RENAMED. `/api/media/:x/tags` stays exactly that. A
 * friendly alias ("Photo tags") would be a second name for every endpoint,
 * drifting out of date the moment a route moved, and it is the literal path
 * that tells you where to go and look. The same reasoning keeps SQLite's own
 * B-tree names in the stats panel. What gets added is the missing half: what
 * KIND of measurement it is, and what the number means.
 *
 * SEVERITY IS READ OFF p95, NOT the average. A p50 is what usually happens; a
 * p95 is what happens often enough to be remembered, and lag is remembered.
 * An endpoint that is quick nineteen times and stalls the twentieth is a
 * problem, and the mean politely hides it.
 *
 * And FAILURES ARE THEIR OWN LIST — `buildFailures`, not a flag inside
 * `buildFindings`. Slowness and brokenness are ranked by different things and a
 * single list has to betray one of them; see that function for the argument.
 */

const finite = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Where each kind of measurement stops being fine, in milliseconds at p95.
 *
 * The three scales are genuinely different and one shared threshold would be
 * wrong twice over:
 *   api    — a request. 1s is where waiting becomes noticeable, 3s is where
 *            people assume it broke.
 *   stall  — a blocked JS thread, i.e. a UI that does not respond at all.
 *            Judged harder than a request for that reason: 250ms of frozen
 *            gesture is felt, a full second reads as a crash.
 *   launch — cold start, which everyone forgives more of. Under 3s is a normal
 *            app launch; past 6s people background it and come back.
 */
const THRESHOLDS = {
  api: { warn: 1000, bad: 3000 },
  stall: { warn: 250, bad: 1000 },
  launch: { warn: 3000, bad: 6000 },
};

/**
 * What one telemetry key IS.
 *
 * `kind` drives the severity scale and the icon; `title` is what the row is
 * called; `hint` is the sentence that makes the number mean something.
 * Anything unrecognised comes back as its own raw key rather than being
 * dropped — a key this file has never heard of is exactly the one worth
 * seeing, and silently hiding it would make the log lie by omission.
 */
export function describeFinding(key) {
  const raw = String(key || '').trim();

  if (raw === 'cold_start') {
    return {
      kind: 'launch',
      title: 'Cold start',
      hint: 'From launch to the first frame the app could draw.',
    };
  }
  if (raw === 'js_stall') {
    return {
      kind: 'stall',
      title: 'Frozen UI',
      hint: 'The JS thread was blocked this long. Taps and scrolls did nothing while it was.',
    };
  }
  if (raw.startsWith('api:')) {
    const path = raw.slice(4) || '/';
    return {
      kind: 'api',
      title: path,
      // ':x' is the telemetry's own placeholder for an id or hash, so every
      // photo doesn't become its own row. Saying so here saves the reader
      // wondering whether it is a real route.
      hint: path.includes(':x')
        ? 'Round trip to the server. ":x" stands in for an id, so every call to this route counts as one.'
        : 'Round trip to the server, measured from the app.',
    };
  }
  return { kind: 'other', title: raw || '(unnamed)', hint: 'Reported by the app.' };
}

/**
 * A raw failure reason from the telemetry, in words.
 *
 * The wire values are `network-error` and `http <status>` — see routes/perf.js.
 * Statuses are read by CLASS rather than from a table of all forty-odd codes:
 * what a person needs from this row is whether the pond broke, refused, or
 * never answered, and the number is kept beside the words for the cases where
 * the exact code matters.
 *
 * An unrecognised reason comes back verbatim. Same rule as an unknown key: the
 * one this file has never seen is the one worth reading.
 */
export function describeFailureReason(reason) {
  const raw = String(reason || '').trim();
  if (!raw) return { label: 'Failed', detail: '' };
  // The request never came back at all — no server, no wifi, or a tunnel that
  // dropped. Distinct from every http status, which at least implies a reply.
  if (raw === 'network-error') return { label: 'No reply', detail: 'never reached the pond, or never came back' };

  const status = /^http\s+(\d{3})$/i.exec(raw);
  if (status) {
    const code = Number(status[1]);
    if (code >= 500) return { label: `Server error ${code}`, detail: 'the pond failed to answer the request' };
    if (code === 404) return { label: 'Not found (404)', detail: 'the route or the thing it asked for is gone' };
    // 401/403 are the interesting 4xx here: on a phone they usually mean an
    // expired token rather than a bug, which is worth NOT calling an error.
    if (code === 401 || code === 403) return { label: `Refused (${code})`, detail: 'signed out, or not allowed' };
    return { label: `Rejected (${code})`, detail: 'the pond turned the request down' };
  }
  return { label: raw, detail: '' };
}

/**
 * 'ok' | 'warn' | 'bad' for a p95 on a given kind's scale.
 *
 * A kind with no scale (an unrecognised key) is never coloured: inventing a
 * threshold for a measurement whose units are unknown would be dressing a
 * guess up as a judgement.
 */
export function severityOf(kind, p95) {
  const scale = THRESHOLDS[kind];
  if (!scale) return 'ok';
  const value = finite(p95);
  if (value >= scale.bad) return 'bad';
  if (value >= scale.warn) return 'warn';
  return 'ok';
}

/**
 * The server's ranked pitfalls as a list a panel can render straight through.
 *
 * The order is the server's and is deliberately NOT re-sorted here: it ranks by
 * total time burned, so a 300ms call made a hundred times outranks a 3s call
 * made twice. That is the honest fixing order, and re-sorting by p95 here would
 * quietly put the rare-and-dramatic back on top.
 *
 * `share` is each row's slice of all the time in the window, which is what the
 * bars are drawn against — a row's own p95 says nothing about how much of the
 * total lag it accounts for.
 */
export function buildFindings(pitfalls, { limit = 12 } = {}) {
  const rows = Array.isArray(pitfalls) ? pitfalls : [];
  const totalMs = rows.reduce((sum, row) => sum + finite(row?.totalMs), 0);

  const findings = rows.slice(0, limit).map((row) => {
    const described = describeFinding(row?.k);
    const p95 = finite(row?.p95);
    const count = finite(row?.count);
    return {
      key: String(row?.k || ''),
      ...described,
      count,
      p50: finite(row?.p50),
      p95,
      max: finite(row?.max),
      totalMs: finite(row?.totalMs),
      severity: severityOf(described.kind, p95),
      share: totalMs > 0 ? finite(row?.totalMs) / totalMs : 0,
      // Carried here as well as in `buildFailures` so a row that is BOTH slow
      // and unreliable says so in the slowness list, instead of looking merely
      // sluggish to anyone who doesn't scroll back up.
      failed: finite(row?.failed),
    };
  });

  return {
    findings,
    totalMs,
    // Everything past the cut, as one number — so the panel can say what it is
    // not showing instead of implying the list is the whole story.
    hiddenCount: Math.max(0, rows.length - findings.length),
  };
}

/**
 * The requests that did not WORK, which is a different list from the slow ones
 * and belongs above them.
 *
 * It has to be built separately rather than filtered out of `buildFindings`,
 * because the two are ordered by different things and `buildFindings` has
 * already truncated to the slowest dozen — a route that fails instantly burns
 * no measurable time, so it can be the single most broken thing in the pond and
 * still fall off the bottom of a list ranked by waiting.
 *
 * Ranked by how MANY times it broke, with the failure rate as the tiebreak and
 * on every row. Count alone would bury a route that fails every single attempt
 * but is only called three times; rate alone would put a one-off 500 above a
 * route that failed two hundred times out of a thousand. Both are shown, so
 * neither reading has to be guessed at.
 */
export function buildFailures(pitfalls, { limit = 8 } = {}) {
  const rows = Array.isArray(pitfalls) ? pitfalls : [];

  const failing = rows
    .filter((row) => finite(row?.failed) > 0)
    .map((row) => {
      const described = describeFinding(row?.k);
      const count = finite(row?.count);
      const failed = finite(row?.failed);
      return {
        key: String(row?.k || ''),
        title: described.title,
        kind: described.kind,
        count,
        failed,
        // Guarded rather than assumed: a `failed` without a `count` would be a
        // malformed row, and dividing by it would put "Infinity%" on screen.
        rate: count > 0 ? Math.min(1, failed / count) : 0,
        reasons: (Array.isArray(row?.reasons) ? row.reasons : []).map((r) => ({
          ...describeFailureReason(r?.reason),
          count: finite(r?.count),
        })),
      };
    });

  failing.sort((a, b) => b.failed - a.failed || b.rate - a.rate);

  return {
    failures: failing.slice(0, limit),
    // Over every failing route, not just the shown ones.
    totalFailed: failing.reduce((sum, row) => sum + row.failed, 0),
    hiddenCount: Math.max(0, failing.length - limit),
  };
}
