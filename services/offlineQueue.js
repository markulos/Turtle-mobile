import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * offlineQueue — a durable outbox for write requests made while the pond is
 * unreachable.
 *
 * The app is optimistic everywhere (see the app-wide rule): a mutation updates
 * local state and closes the UI immediately, then persists in the background.
 * That rule breaks down the moment the phone is off the network — the write
 * simply fails, the UI reverts, and the edit is lost. This module is the other
 * half: a write that can't reach the server is PARKED on disk instead of lost,
 * and replayed in order the next time the server answers.
 *
 * Design notes:
 *   • Persisted with AsyncStorage, so a queued edit survives an app restart —
 *     the common offline case is "edit on the subway, app gets killed".
 *   • FIFO, and the flush STOPS at the first network failure. Requests can be
 *     order-dependent (rename then add-to-playlist on the same row), so a
 *     later entry must never overtake a stalled earlier one.
 *   • `key` collapses supersedable writes: renaming a track three times
 *     offline should send ONE request, the last one. Entries without a key are
 *     never collapsed.
 *   • A 4xx (except 408/429) is the server saying "this will never work" — the
 *     entry is dropped rather than retried forever. Network errors, timeouts,
 *     429s and 5xx stay queued.
 */

const STORAGE_KEY = 'turtle:offlineQueue:v1';
// Hard cap so a long offline stretch can't grow the outbox without bound.
// Oldest entries are dropped first.
const MAX_ENTRIES = 200;
// Backoff ladder for the auto-flush timer, in ms. Only runs while the queue is
// non-empty; resets to the first rung after a successful flush.
const RETRY_MS = [15000, 30000, 60000, 120000];

let queue = [];
let loaded = false;
let loadPromise = null;
let seq = 0;
const listeners = new Set();

const notify = () => {
  const snapshot = queue.slice();
  listeners.forEach((fn) => {
    try { fn(snapshot); } catch { /* a bad listener must not break the queue */ }
  });
};

const persist = async () => {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch (e) {
    console.warn('[offlineQueue] persist failed:', e?.message || e);
  }
};

/** Load the outbox from disk once per app run. Safe to call repeatedly. */
export async function loadQueue() {
  if (loaded) return queue;
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        queue = Array.isArray(parsed) ? parsed.filter((e) => e && e.method && e.path) : [];
      } catch (e) {
        console.warn('[offlineQueue] load failed:', e?.message || e);
        queue = [];
      }
      loaded = true;
      notify();
      return queue;
    })();
  }
  return loadPromise;
}

/** Current pending entries (a copy — mutating it does nothing). */
export function getPending() {
  return queue.slice();
}

/** The newest pending entry for `key`, or null. Call sites use this to paint
 *  an offline edit after a restart, before it has been sent. */
export function getPendingByKey(key) {
  for (let i = queue.length - 1; i >= 0; i -= 1) {
    if (queue[i].key === key) return queue[i];
  }
  return null;
}

/** Subscribe to queue changes; returns an unsubscribe fn. */
export function subscribe(listener) {
  listeners.add(listener);
  listener(queue.slice());
  return () => listeners.delete(listener);
}

/**
 * Park a request. `key` (optional) collapses this entry with an existing
 * pending one — the newer body wins and KEEPS the older entry's position, so
 * collapsing can't reorder writes.
 */
export async function enqueue({ method, path, body = null, key = null, label = '' }) {
  await loadQueue();
  seq += 1;
  const queuedAt = Date.now();
  const entry = {
    id: `q${queuedAt}_${seq}`,
    method: String(method).toLowerCase(),
    path,
    body,
    key,
    label,
    queuedAt,
    attempts: 0,
  };
  const at = key ? queue.findIndex((e) => e.key === key) : -1;
  if (at >= 0) queue[at] = { ...entry, id: queue[at].id, queuedAt: queue[at].queuedAt };
  else queue.push(entry);
  if (queue.length > MAX_ENTRIES) queue = queue.slice(queue.length - MAX_ENTRIES);
  await persist();
  notify();
  return entry;
}

/** Drop everything. Used by sign-out and by the settings "discard" action. */
export async function clearQueue() {
  queue = [];
  loaded = true;
  await persist();
  notify();
}

// A thrown API error carries its status in the message ('API Error 404: …',
// 'API 404 on GET …'). Anything without a status was a transport failure —
// no network, dead tunnel, aborted timeout — which is exactly what the queue
// exists for.
function statusOf(error) {
  const m = /\b(\d{3})\b/.exec(String(error?.message || ''));
  const n = m ? Number(m[1]) : 0;
  return n >= 100 && n <= 599 ? n : 0;
}

/** True when the failure means "never going to work" — drop, don't retry. */
export function isPermanentFailure(error) {
  const status = statusOf(error);
  if (!status) return false;              // transport failure → keep queued
  if (status === 408 || status === 429) return false;
  return status >= 400 && status < 500;
}

/**
 * Replay the outbox against `api`. Returns { sent, dropped, remaining }.
 * Stops at the first entry that fails for a retryable reason, so order holds.
 */
export async function flushQueue(api) {
  await loadQueue();
  if (!queue.length || !api) return { sent: 0, dropped: 0, remaining: queue.length };

  let sent = 0;
  let dropped = 0;
  while (queue.length) {
    const entry = queue[0];
    const call = api[entry.method];
    if (typeof call !== 'function') {
      // Unknown verb — nothing will ever send it.
      queue.shift();
      dropped += 1;
      continue;
    }
    try {
      await (entry.body == null ? call(entry.path) : call(entry.path, entry.body));
      queue.shift();
      sent += 1;
    } catch (e) {
      if (isPermanentFailure(e)) {
        console.warn(`[offlineQueue] dropping ${entry.method.toUpperCase()} ${entry.path}:`, e?.message || e);
        queue.shift();
        dropped += 1;
        continue;
      }
      entry.attempts += 1;
      entry.lastError = String(e?.message || e).slice(0, 200);
      break;
    }
  }
  await persist();
  notify();
  return { sent, dropped, remaining: queue.length };
}

/**
 * Try to send now; park it if the pond can't be reached.
 *
 * Resolves { queued: false, result } when it went through, { queued: true }
 * when it was parked. Only PERMANENT failures reject — a call site that
 * already updated its UI optimistically should revert on a reject and leave
 * the optimistic state alone on a queued result.
 */
export async function sendOrQueue(api, { method, path, body = null, key = null, label = '' }) {
  const verb = String(method).toLowerCase();
  const call = api?.[verb];
  if (typeof call !== 'function') throw new Error(`offlineQueue: unsupported method ${method}`);
  try {
    const result = await (body == null ? call(path) : call(path, body));
    return { queued: false, result };
  } catch (e) {
    if (isPermanentFailure(e)) throw e;
    await enqueue({ method: verb, path, body, key, label });
    return { queued: true, error: e };
  }
}

/**
 * Start the retry loop. Flushes once now, then on a backoff ladder for as long
 * as anything is pending. Returns a stop fn.
 *
 * The app has no NetInfo dependency, and ServerContext's `isConnected` is only
 * probed at startup — so "are we back online?" is answered the cheap way: by
 * trying the queue again on a timer, and whenever the app comes to the
 * foreground (the caller wires that part).
 */
export function startAutoFlush(api, { onFlush } = {}) {
  let stopped = false;
  let timer = null;
  let rung = 0;

  const tick = async () => {
    if (stopped) return;
    let remaining = 0;
    try {
      const res = await flushQueue(api);
      remaining = res.remaining;
      if (res.sent > 0) rung = 0;
      onFlush?.(res);
    } catch (e) {
      console.warn('[offlineQueue] flush error:', e?.message || e);
      remaining = getPending().length;
    }
    if (stopped) return;
    if (remaining > 0) {
      const wait = RETRY_MS[Math.min(rung, RETRY_MS.length - 1)];
      rung += 1;
      timer = setTimeout(tick, wait);
    } else {
      rung = 0;
      timer = null;
    }
  };

  // Re-arm whenever something new is parked while idle.
  const unsubscribe = subscribe((entries) => {
    if (stopped || timer || !entries.length) return;
    timer = setTimeout(tick, RETRY_MS[0]);
  });

  tick();

  return () => {
    stopped = true;
    unsubscribe();
    if (timer) clearTimeout(timer);
    timer = null;
  };
}

/** Test seam — drops the in-memory state so each test starts clean. */
export function __resetForTests() {
  queue = [];
  loaded = false;
  loadPromise = null;
  seq = 0;
  listeners.clear();
}
