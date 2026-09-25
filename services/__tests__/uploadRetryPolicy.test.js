import {
  BUSY_JITTER_MS,
  BUSY_WAIT_BUDGET_MS,
  BUSY_WAIT_MAX_MS,
  decideRetry,
  isBusyRefusal,
  parseRetryAfterMs,
  transportRetryDelayMs,
} from '../uploadRetryPolicy';

// The pond's admission gate, byte for byte (routes/media.js createUploadIngressAdmission).
const BUSY_BODY = '{"success":false,"retryable":true,"error":"Upload ingress is busy; retry shortly"}';
const noJitter = () => 0;

describe('parseRetryAfterMs', () => {
  it('reads delay-seconds, whatever the header name’s case', () => {
    expect(parseRetryAfterMs({ 'Retry-After': '1' })).toBe(1000);
    expect(parseRetryAfterMs({ 'retry-after': '30' })).toBe(30000);
    expect(parseRetryAfterMs({ 'RETRY-AFTER': ' 2 ' })).toBe(2000);
  });

  it('reads an HTTP-date relative to the clock it is given', () => {
    const now = Date.parse('2026-09-25T12:00:00Z');
    expect(parseRetryAfterMs({ 'Retry-After': 'Fri, 25 Sep 2026 12:00:05 GMT' }, now)).toBe(5000);
    // A date already in the past is "now", not a negative wait.
    expect(parseRetryAfterMs({ 'Retry-After': 'Fri, 25 Sep 2026 11:59:00 GMT' }, now)).toBe(0);
  });

  it('is null when the header is missing or unreadable', () => {
    expect(parseRetryAfterMs(undefined)).toBeNull();
    expect(parseRetryAfterMs({})).toBeNull();
    expect(parseRetryAfterMs({ 'Retry-After': '' })).toBeNull();
    expect(parseRetryAfterMs({ 'Retry-After': 'soon' })).toBeNull();
  });
});

describe('isBusyRefusal', () => {
  it('recognises the pond’s admission refusal in either body shape', () => {
    expect(isBusyRefusal({ status: 503, body: BUSY_BODY })).toBe(true);
    expect(isBusyRefusal({ status: 503, body: { success: false, retryable: true } })).toBe(true);
  });

  it('treats a 429 and a 503 that names a Retry-After as "not now"', () => {
    expect(isBusyRefusal({ status: 429, body: 'slow down' })).toBe(true);
    expect(isBusyRefusal({ status: 503, body: '<html>maintenance</html>', headers: { 'retry-after': '10' } })).toBe(true);
  });

  it('does not mistake an edge or a dead origin for a busy pond', () => {
    // Cloudflare’s own 503 page: no retryable flag, no Retry-After.
    expect(isBusyRefusal({ status: 503, body: '<html>error code: 503</html>' })).toBe(false);
    expect(isBusyRefusal({ status: 502, body: BUSY_BODY })).toBe(false);
    expect(isBusyRefusal({ status: 500, body: 'boom' })).toBe(false);
    expect(isBusyRefusal({ status: 0 })).toBe(false);
  });
});

describe('decideRetry — a busy pond', () => {
  const busy = (over = {}) => decideRetry({ status: 503, body: BUSY_BODY, attempt: 1, maxAttempts: 3, random: noJitter, ...over });

  it('waits at least what Retry-After asks and does not spend a transfer attempt', () => {
    const v = busy({ headers: { 'Retry-After': '3' } });
    expect(v).toEqual({ action: 'retry', busy: true, delayMs: 3000, reason: 'busy' });
  });

  it('backs off further each time the pond keeps saying no', () => {
    const delays = [0, 1, 2, 3, 4, 5].map((busyWaits) => busy({ headers: { 'Retry-After': '1' }, busyWaits }).delayMs);
    expect(delays).toEqual([1000, 2000, 4000, 8000, 15000, 15000]);
    expect(Math.max(...delays)).toBe(BUSY_WAIT_MAX_MS);
  });

  it('never waits under a second, nor longer than the cap, whatever the hint says', () => {
    expect(busy({ headers: { 'Retry-After': '0' } }).delayMs).toBe(1000);
    expect(busy({}).delayMs).toBe(1000);
    expect(busy({ headers: { 'Retry-After': '600' } }).delayMs).toBe(BUSY_WAIT_MAX_MS);
  });

  it('adds jitter so eight refused uploads do not all knock again in the same instant', () => {
    const v = busy({ headers: { 'Retry-After': '2' }, random: () => 0.5 });
    expect(v.delayMs).toBe(2000 + Math.floor(0.5 * BUSY_JITTER_MS));
    expect(busy({ random: () => 0.999 }).delayMs).toBeLessThan(1000 + BUSY_JITTER_MS);
  });

  it('gives up once the busy budget is spent', () => {
    expect(busy({ busyWaitedMs: BUSY_WAIT_BUDGET_MS - 1 }).action).toBe('retry');
    expect(busy({ busyWaitedMs: BUSY_WAIT_BUDGET_MS })).toEqual({ action: 'fail', busy: true, delayMs: 0, reason: 'busy-budget' });
  });

  it('is the same verdict on the last transfer attempt — a refusal is not an attempt', () => {
    expect(busy({ attempt: 3, maxAttempts: 3 }).action).toBe('retry');
  });
});

describe('decideRetry — transport failures keep the attempt ladder', () => {
  it('retries a 5xx, a 408 and a silent transport on the existing linear backoff', () => {
    expect(decideRetry({ status: 500, attempt: 1, maxAttempts: 3 })).toEqual({ action: 'retry', busy: false, delayMs: 1500, reason: 'transient' });
    expect(decideRetry({ status: 502, attempt: 2, maxAttempts: 3 }).delayMs).toBe(3000);
    expect(decideRetry({ status: 408, attempt: 1, maxAttempts: 3 }).action).toBe('retry');
    expect(decideRetry({ status: 0, attempt: 1, maxAttempts: 3 }).action).toBe('retry');
    expect(transportRetryDelayMs(2)).toBe(3000);
  });

  it('stops at the caller’s attempt ceiling', () => {
    expect(decideRetry({ status: 500, attempt: 3, maxAttempts: 3 })).toEqual({ action: 'fail', busy: false, delayMs: 0, reason: 'attempts' });
    expect(decideRetry({ status: 500, attempt: 1, maxAttempts: 1 }).action).toBe('fail');
  });

  it('never resends after a 4xx decision', () => {
    for (const status of [400, 401, 403, 413, 415, 422]) {
      expect(decideRetry({ status, attempt: 1, maxAttempts: 3 })).toEqual({ action: 'fail', busy: false, delayMs: 0, reason: 'rejected' });
    }
  });
});
