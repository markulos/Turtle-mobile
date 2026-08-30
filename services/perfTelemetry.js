/**
 * Passive performance telemetry — the phone reports what actually felt slow,
 * so "why does the app lag" gets answered from data instead of memory.
 *
 * ── What it measures (nothing else) ──────────────────────────────────────
 *   api:<route>   every fetch to the pond's /api/*, wall-clock ms, with the
 *                 route normalized (ids/hashes collapsed to ':x') so "the
 *                 gallery endpoint is slow" aggregates instead of splintering
 *                 into one key per photo id.
 *   js_stall      event-loop stalls: a 500ms heartbeat that arrives late by
 *                 >100ms means SOMETHING blocked the JS thread that long —
 *                 the exact thing a user feels as a frozen gesture. The
 *                 overshoot is the sample. The beat spanning an AppState
 *                 change is dropped, because a backgrounded app's timer is
 *                 suspended and would otherwise report the length of the
 *                 user's lunch break as jank (see createStallGate).
 *   cold_start    module-load → first idle heartbeat, once per launch.
 *
 * ── Why it can never make things worse ───────────────────────────────────
 * Fire-and-forget: batches flush in the background (every 60s, and when the
 * app backgrounds); a failed flush DROPS the batch — telemetry never queues,
 * never retries, never competes with real traffic. The buffer is capped, the
 * report POST is excluded from its own measurement, and every handler is
 * wrapped so a telemetry bug cannot break a real request.
 *
 * ── Zero-touch integration ───────────────────────────────────────────────
 * Imported once from the app entry (index.js), BEFORE the app module graph:
 * it wraps global.fetch and learns the pond's origin by observing the first
 * /api/ call, so it needs no import from ServerContext (whose own auth
 * interceptor still runs and attaches the Bearer token to our flush POST —
 * the server ingests per-user under the normal auth gate).
 */
import { AppState, Platform } from 'react-native';

const MODULE_LOAD_AT = Date.now();
// Under jest the pure exports are the test surface; the live side effects
// (fetch wrap, heartbeat, flush timers, AppState listener) would hold the
// event loop open and hang every suite that transitively imports this file.
const IS_TEST = typeof process !== 'undefined' && !!(process.env && process.env.JEST_WORKER_ID);
const FLUSH_MS = 60 * 1000;
const HEARTBEAT_MS = 500;
const STALL_OVERSHOOT_MS = 100;
const BUFFER_CAP = 500;
const BATCH_CAP = 200;
const REPORT_PATH = '/api/perf/report';

const buffer = [];
let serverOrigin = '';    // learned from observed /api/ traffic
let coldStartSent = false;
let appVersion = '';
try {
  // Optional; present in Expo apps. Failing to resolve must cost nothing.
  // eslint-disable-next-line global-require
  const Constants = require('expo-constants').default;
  appVersion = (Constants?.expoConfig?.version) || '';
} catch { /* fine — version stays blank */ }

/** Collapse volatile path segments so routes aggregate. */
export function normalizeRouteKey(url) {
  try {
    const path = String(url).replace(/^[a-z]+:\/\/[^/]+/i, '').split('?')[0];
    const collapsed = path
      .split('/')
      .map((seg) => {
        if (!seg) return seg;
        // A file extension must not disguise an id: 0794…c.jpg is still an id.
        const stem = seg.replace(/\.\w{1,5}$/, '');
        if (/^\d{4,}$/.test(stem)) return ':x';                       // long numbers
        if (/^[0-9a-f-]{16,}$/i.test(stem)) return ':x';              // uuids/hashes
        if (/^(media|task|cs|csa|t)[-_][\w-]{6,}$/i.test(stem)) return ':x'; // app ids
        if (seg.length > 40) return ':x';
        return seg;
      })
      .join('/');
    return `api:${collapsed}`.slice(0, 80);
  } catch {
    return 'api:(unparseable)';
  }
}

export function record(k, ms, meta) {
  if (buffer.length >= BUFFER_CAP) buffer.shift(); // oldest sample pays
  buffer.push({ k, ms: Math.round(ms), at: Date.now(), ...(meta ? { meta } : {}) });
}

// Exported for tests only.
export const _internals = { buffer, get serverOrigin() { return serverOrigin; } };

// ── fetch wrapper ───────────────────────────────────────────────────────────
const origFetch = global.fetch;
if (!IS_TEST) global.fetch = (input, init) => {
  let url = '';
  try { url = typeof input === 'string' ? input : (input && input.url) || ''; } catch { /* opaque input */ }
  const isApi = url.includes('/api/');
  const isSelf = url.endsWith(REPORT_PATH);
  if (!isApi || isSelf) return origFetch(input, init);
  const t0 = Date.now();
  return origFetch(input, init).then(
    (res) => {
      try {
        if (!serverOrigin) {
          const m = /^([a-z]+:\/\/[^/]+)\//i.exec(url);
          if (m) serverOrigin = m[1];
        }
        record(normalizeRouteKey(url), Date.now() - t0, res.ok ? undefined : `http ${res.status}`);
      } catch { /* telemetry must never break a request */ }
      return res;
    },
    (err) => {
      try { record(normalizeRouteKey(url), Date.now() - t0, 'network-error'); } catch { /* ditto */ }
      throw err;
    },
  );
};

/**
 * Decides whether a late heartbeat is a STALL or just the app having been away.
 *
 * The heartbeat measures lateness, and a suspended app is infinitely late: the
 * OS stops the timer on background and the first beat after resume overshoots
 * by the whole time the phone was in a pocket. Nothing about that was a blocked
 * JS thread, but it is indistinguishable from one by lateness alone.
 *
 * It is not a rounding error. Over 2026-08-28..30 prod recorded 698 js_stall
 * samples with a p95 of 55.5 SECONDS and a max of 570,614ms — nine and a half
 * minutes, on a metric whose threshold is 100ms. That key's total was ~50x the
 * next worst, so it sat permanently at the top of the owner's ranked pitfalls
 * and pushed every real finding underneath it. The server's ingest cap is
 * 10 minutes (routes/perf.js), which is far too loose to catch this — and
 * should stay loose, since a real chat turn legitimately runs a minute.
 *
 * So the gate is a one-beat amnesty: ANY AppState transition makes the next
 * beat untrustworthy and it is dropped. Deliberately any transition and not
 * just background→active, because iOS 'inactive' (control centre, an incoming
 * call, the app switcher) also parks the thread without a background event,
 * and losing one 500ms sample costs nothing against a metric with hundreds.
 *
 * Exported and free of timers, AppState and module state so it can be tested
 * directly rather than through a fake clock.
 */
export function createStallGate() {
  // Starts trusting: beat 1 never reaches here, because the cold_start branch
  // below returns first, and beat 2 onwards is a genuine 500ms interval.
  let suspect = false;
  return {
    /** Any AppState change at all — the next beat spans it and cannot be read. */
    noteAppStateChange() { suspect = true; },
    /** @returns {boolean} whether `overshoot` should be recorded as a stall. */
    accept(overshoot, threshold) {
      // The amnesty is spent whether or not this beat was late, so a quiet
      // return from background does not leave the gate armed indefinitely.
      if (suspect) { suspect = false; return false; }
      return overshoot > threshold;
    },
  };
}

// ── heartbeat: stalls + cold start ──────────────────────────────────────────
const stallGate = createStallGate();
let lastBeat = Date.now();
if (!IS_TEST) setInterval(() => {
  const now = Date.now();
  const overshoot = now - lastBeat - HEARTBEAT_MS;
  lastBeat = now;
  if (!coldStartSent) {
    coldStartSent = true;
    record('cold_start', now - MODULE_LOAD_AT);
    return; // the first interval includes module-eval time; not a stall
  }
  if (stallGate.accept(overshoot, STALL_OVERSHOOT_MS)) record('js_stall', overshoot);
}, HEARTBEAT_MS);

// ── flush ───────────────────────────────────────────────────────────────────
// Through global.fetch DELIBERATELY: this module loads first, so ServerContext's
// auth interceptor patches OVER our wrapper — at flush time global.fetch is
// interceptor→ours→native, which attaches the Bearer token and then skips our
// own POST via the isSelf guard. The server ingests per-user, normally authed.
async function flush() {
  if (!buffer.length || !serverOrigin) return;
  const samples = buffer.splice(0, BATCH_CAP);
  try {
    await global.fetch(`${serverOrigin}${REPORT_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: Platform.OS, appVersion, samples }),
    });
  } catch { /* dropped — telemetry never retries */ }
}

if (!IS_TEST) {
  setInterval(flush, FLUSH_MS);
  AppState.addEventListener('change', (s) => {
    // Before the flush, and for EVERY state — the gate has to hear about the
    // return to 'active' as much as the departure from it, since the beat that
    // spans a resume is the one carrying the whole suspended interval.
    stallGate.noteAppStateChange();
    if (s === 'background' || s === 'inactive') flush();
  });
}
