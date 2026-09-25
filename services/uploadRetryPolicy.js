/**
 * uploadRetryPolicy — the ONE place that decides what a failed upload attempt
 * does next. Pure: no timers, no I/O, no console. streamMultipartUpload asks
 * for a verdict and carries it out, so the rules are testable on their own and
 * every door into the vault (the upload queue, share-to-Turtle, the Files tab)
 * inherits the same behaviour.
 *
 * WHY THIS EXISTS (the 503 reports, 2026-09-09 → 09-21): the pond admits only
 * a handful of whole-file uploads at once and answers the rest with
 * `503 {"retryable":true,"error":"Upload ingress is busy; retry shortly"}` plus
 * a `Retry-After` header — in 3 ms, before a byte of the file is read. The
 * uploader treated that refusal as a transfer attempt: it slept a fixed
 * 1.5 s, then 3 s, and after the third refusal marked a perfectly good photo
 * FAILED. 688 of 1866 upload requests in the pond's log were that refusal.
 * A refusal is not a failed transfer — nothing was sent — so it gets its own
 * budget, measured in time rather than attempts, and it honours the server's
 * own hint instead of a constant.
 */

/** Total time one upload may spend waiting for admission before giving up. */
export const BUSY_WAIT_BUDGET_MS = 90_000;
/** A single wait is never shorter than this, whatever Retry-After says. */
export const BUSY_WAIT_MIN_MS = 1_000;
/** …nor longer than this, so a bad hint cannot park an upload for minutes. */
export const BUSY_WAIT_MAX_MS = 15_000;
/** Spread eight simultaneous retries out instead of letting them collide again. */
export const BUSY_JITTER_MS = 500;
/** The transport-failure ladder the uploader has always used: 1.5 s, 3 s, … */
export const TRANSPORT_RETRY_STEP_MS = 1_500;

/**
 * `Retry-After` as milliseconds, or null when absent or unreadable. Both
 * forms the header allows: delay-seconds and an HTTP-date. Header names are
 * matched case-insensitively — Node sends `Retry-After`, an HTTP/2 edge
 * lowercases it, and iOS hands back whichever it received.
 */
export function parseRetryAfterMs(headers, now = Date.now()) {
  if (!headers || typeof headers !== 'object') return null;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === 'retry-after');
  if (!key) return null;
  const raw = String(headers[key] ?? '').trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw) * 1000;
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now);
}

/** The response body as an object, whether it arrived parsed or as text. */
function bodyObject(body) {
  if (body && typeof body === 'object') return body;
  if (typeof body !== 'string' || !body) return null;
  try { return JSON.parse(body); } catch { return null; }
}

/**
 * Is this answer "not now" rather than "no"? The pond's admission gate says so
 * explicitly (`retryable: true` on a 503); a 429 is the same message from a
 * rate limiter; and any 503 that bothers to send Retry-After means it too.
 * A bare 503 with an HTML body is an edge or a dead origin, and that is a
 * transport failure, handled by the attempt ladder below.
 */
export function isBusyRefusal({ status, body, headers } = {}) {
  if (status === 429) return true;
  if (status !== 503) return false;
  const parsed = bodyObject(body);
  if (parsed?.retryable === true) return true;
  return parseRetryAfterMs(headers) != null;
}

/** How long a transport retry waits before attempt `attempt + 1`. */
export function transportRetryDelayMs(attempt) {
  return Math.max(1, Number(attempt) || 1) * TRANSPORT_RETRY_STEP_MS;
}

/**
 * The verdict for one non-2xx answer (or a transport error, status 0).
 *
 * @param {object} p
 * @param {number} p.status        HTTP status; 0 for no response at all
 * @param {string|object} [p.body] response body
 * @param {object} [p.headers]     response headers
 * @param {number} p.attempt       1-based transfer attempt this answer belongs to
 * @param {number} p.maxAttempts   the caller's transfer-attempt ceiling
 * @param {number} [p.busyWaits]   admission refusals already waited out
 * @param {number} [p.busyWaitedMs] time already spent waiting for admission
 * @param {number} [p.now]         injectable clock (HTTP-date Retry-After)
 * @param {() => number} [p.random] injectable jitter source, [0, 1)
 * @returns {{ action: 'retry'|'fail', busy: boolean, delayMs: number, reason: string }}
 *   busy=true verdicts do NOT count as transfer attempts: the caller waits
 *   `delayMs` and sends the same attempt number again.
 */
export function decideRetry({
  status = 0,
  body,
  headers,
  attempt = 1,
  maxAttempts = 3,
  busyWaits = 0,
  busyWaitedMs = 0,
  now = Date.now(),
  random = Math.random,
} = {}) {
  const code = Number(status) || 0;

  if (isBusyRefusal({ status: code, body, headers })) {
    if (busyWaitedMs >= BUSY_WAIT_BUDGET_MS) {
      return { action: 'fail', busy: true, delayMs: 0, reason: 'busy-budget' };
    }
    // The server's hint is a floor, never a ceiling: it says "not before",
    // and a pond that keeps saying it earns a longer pause each time.
    const hinted = parseRetryAfterMs(headers, now) ?? 0;
    const ladder = BUSY_WAIT_MIN_MS * 2 ** Math.min(Math.max(0, busyWaits), 4);
    const base = Math.min(BUSY_WAIT_MAX_MS, Math.max(BUSY_WAIT_MIN_MS, hinted, ladder));
    const jitter = Math.floor(Math.max(0, Math.min(0.999999, random())) * BUSY_JITTER_MS);
    return { action: 'retry', busy: true, delayMs: base + jitter, reason: 'busy' };
  }

  // Nothing answered, the pond fell over mid-request, or it asked for time
  // (408): worth another go, on the attempt ladder.
  const transient = code === 0 || code >= 500 || code === 408;
  if (transient) {
    if (attempt < maxAttempts) {
      return { action: 'retry', busy: false, delayMs: transportRetryDelayMs(attempt), reason: 'transient' };
    }
    return { action: 'fail', busy: false, delayMs: 0, reason: 'attempts' };
  }

  // A 4xx is a decision, not weather. Sending the same bytes again changes
  // nothing.
  return { action: 'fail', busy: false, delayMs: 0, reason: 'rejected' };
}
