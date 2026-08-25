/**
 * Is the TURTLE-3D collab bridge up?
 *
 * ── Why this is a SEPARATE request to a SEPARATE host ────────────────────
 * The Turtle app server mints the credentials a bridge uses to check sign-in
 * tokens, and that is the whole of the relationship: no socket, no heartbeat,
 * no idea whether the bridge is running. The Turtle3D panel was therefore
 * honest but blind — it could say when a bridge last introspected a token
 * (`lastUsedAt`), which moves only when somebody signs in, and nothing more.
 *
 * The bridge does answer for itself. It is an axum server exposing
 * `GET /health` → `{ status, entities }`, so asking IT is the only way to
 * learn whether collab is actually up. That request goes to the bridge's own
 * address (collab.t3d.ca), never to the app server — pointing it at the app
 * server would just re-report the app server's own liveness under a collab
 * label, which is the confusion this exists to remove.
 *
 * The address is resolved from the pond's `collab_base_url` setting when the
 * owner has set one, so it can be repointed (a different host, a LAN address
 * while testing) without shipping a new build.
 */

/** Where a collab bridge answers unless the pond says otherwise. */
export const DEFAULT_COLLAB_BASE = 'https://collab.t3d.ca';

/** Give up well before a user decides the screen is broken. */
export const HEALTH_TIMEOUT_MS = 6000;

/**
 * Normalise a base URL: trim, drop trailing slashes, and add a scheme when
 * one is missing so a setting of "collab.t3d.ca" still works.
 *
 * Returns null for anything unusable, so the caller falls back to the default
 * rather than fetching a malformed URL and reporting a confusing failure.
 */
export function normalizeBase(raw) {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  s = s.replace(/\/+$/, '');
  // A bare scheme, or a scheme with no host, is not a base URL.
  if (!/^https?:\/\/[^/\s]+/i.test(s)) return null;
  return s;
}

/** The address to probe: the pond's setting when usable, else the default. */
export function resolveCollabBase(settings) {
  const configured = settings && typeof settings === 'object'
    ? normalizeBase(settings.collab_base_url)
    : null;
  return configured || DEFAULT_COLLAB_BASE;
}

/**
 * Turn a bridge `/health` payload into what the panel shows.
 *
 * The bridge answers `{ status: "ok", entities: <count> }`. Anything else —
 * a proxy's HTML error page, a JSON body of another shape — is reported as
 * reachable-but-unrecognised rather than as "up", because a Cloudflare error
 * page returning 200 must not read as a healthy bridge.
 */
export function readHealth(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, reason: 'unrecognised' };
  }
  if (payload.status !== 'ok') {
    return { ok: false, reason: 'unrecognised' };
  }
  const entities = Number.isFinite(payload.entities) ? payload.entities : null;
  return { ok: true, entities };
}

/**
 * Describe a failure in terms of what the owner can do about it.
 *
 * The distinction that matters: DNS resolving with nothing behind it (the
 * hostname exists at Cloudflare but no tunnel route is wired) times out,
 * whereas a running-but-refusing bridge answers with a status. Those need
 * different fixes, so they must not both read as "offline".
 */
export function describeFailure(kind, status) {
  if (kind === 'timeout') return 'No answer — the address resolves but nothing is serving it yet.';
  if (kind === 'network') return 'Could not reach it — check the address and your connection.';
  if (kind === 'http') {
    if (status === 404) return 'Reached a server, but it has no /health — is that the bridge?';
    if (status === 401 || status === 403) return `Reached it, but it refused the request (${status}).`;
    return `Reached it, but it answered ${status}.`;
  }
  return 'Reached it, but the reply was not a bridge health response.';
}

/**
 * Probe a bridge. Never throws — every outcome is a value the panel renders.
 *
 * @param {string} base   already-resolved base URL
 * @param {object} [opts] { timeoutMs, fetchImpl } — injectable for tests
 */
export async function probeCollab(base, opts = {}) {
  const timeoutMs = opts.timeoutMs || HEALTH_TIMEOUT_MS;
  const doFetch = opts.fetchImpl || fetch;
  const url = `${base}/health`;
  const started = Date.now();

  // AbortController rather than Promise.race: racing leaves the request in
  // flight, and a phone that pans through this screen would pile them up.
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => controller && controller.abort(), timeoutMs);
  try {
    const res = await doFetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      ...(controller ? { signal: controller.signal } : {}),
    });
    const ms = Date.now() - started;
    if (!res.ok) {
      return { state: 'down', url, ms, detail: describeFailure('http', res.status), status: res.status };
    }
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    const read = readHealth(body);
    if (!read.ok) {
      return { state: 'down', url, ms, detail: describeFailure('shape'), status: res.status };
    }
    return { state: 'up', url, ms, entities: read.entities, status: res.status };
  } catch (e) {
    const ms = Date.now() - started;
    const aborted = e && (e.name === 'AbortError' || /abort/i.test(e.message || ''));
    return {
      state: 'down',
      url,
      ms,
      detail: describeFailure(aborted ? 'timeout' : 'network'),
      timedOut: !!aborted,
    };
  } finally {
    clearTimeout(timer);
  }
}
