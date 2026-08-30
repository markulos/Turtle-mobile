/**
 * The launch race that produced the 401 storm.
 *
 * AuthContext restores the JWT from SecureStore asynchronously, so for the
 * first few hundred milliseconds of a launch the module-level token holder is
 * null and indistinguishable from a signed-out app. Prod telemetry over
 * 2026-08-28..30: 34 of 36 failed /api/media/gallery requests landed 0.3-0.9s
 * after a cold start, across 35 cold starts.
 *
 * These drive the interceptor directly rather than through a rendered tree —
 * the behaviour under test is module state and the patched global.fetch, and a
 * renderer would only obscure which of the two is doing the work.
 */

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/offlineQueue', () => ({
  flushQueue: jest.fn(),
  startAutoFlush: jest.fn(),
}));

const ORIGIN = 'http://100.85.19.127:3000';

let native;      // the fetch the interceptor wrapped
let patched;     // the interceptor itself
let ctx;

const load = () => {
  jest.resetModules();
  native = jest.fn(() => Promise.resolve({ ok: true, status: 200 }));
  global.fetch = native;
  // eslint-disable-next-line global-require
  ctx = require('../ServerContext');
  patched = global.fetch;
  expect(patched).not.toBe(native); // the interceptor really installed
  return ctx;
};

const authOf = (call) => {
  const init = call[1];
  if (!init || !init.headers) return null;
  return init.headers.get ? init.headers.get('Authorization') : init.headers.Authorization;
};

beforeEach(() => {
  jest.useFakeTimers();
  load();
  // The origin is normally learned from provider render; set it the way the
  // provider does so these tests exercise the interceptor in isolation.
  ctx.setApiAuthToken(null);
  ctx._setServerApiOriginForTests(ORIGIN);
});

afterEach(() => {
  jest.useRealTimers();
});

test('a pond request before the restore settles is HELD, not sent bare', async () => {
  patched(`${ORIGIN}/api/media/gallery?limit=60`);
  await Promise.resolve();
  expect(native).not.toHaveBeenCalled();
});

test('it is released carrying the token once the restore settles', async () => {
  const inFlight = patched(`${ORIGIN}/api/media/gallery?limit=60`);
  await Promise.resolve();
  expect(native).not.toHaveBeenCalled();

  // Exactly the order AuthContext uses: token into the holder first, THEN the
  // gate opens. Reversed, this test fails with a null Authorization — which is
  // the bug being fixed.
  ctx.setApiAuthToken('jwt-abc');
  ctx.markAuthSettled();
  await inFlight;

  expect(native).toHaveBeenCalledTimes(1);
  expect(authOf(native.mock.calls[0])).toBe('Bearer jwt-abc');
});

test('a signed-out launch is a settled answer — requests go, just bare', async () => {
  const inFlight = patched(`${ORIGIN}/api/health`);
  ctx.markAuthSettled();          // no token found; still settled
  await inFlight;

  expect(native).toHaveBeenCalledTimes(1);
  expect(authOf(native.mock.calls[0])).toBeNull();
});

test('once settled the path is synchronous — no await, no deferral', () => {
  ctx.setApiAuthToken('jwt-abc');
  ctx.markAuthSettled();

  patched(`${ORIGIN}/api/tasks`);
  // Called during the call itself, with no microtask drained: this is what
  // keeps the gate off the hot path for every request after the first second.
  expect(native).toHaveBeenCalledTimes(1);
  expect(authOf(native.mock.calls[0])).toBe('Bearer jwt-abc');
});

test('third-party URLs are never held, settled or not', () => {
  patched('https://exp.host/--/api/v2/push/getExpoPushToken');
  expect(native).toHaveBeenCalledTimes(1);
  // ...and of course carry no pond token.
  expect(authOf(native.mock.calls[0])).toBeNull();
});

test('the gate fails OPEN if the settle signal never arrives', async () => {
  const inFlight = patched(`${ORIGIN}/api/media/gallery`);
  await Promise.resolve();
  expect(native).not.toHaveBeenCalled();

  // markAuthSettled() is never called — a missed flag must not hang the app.
  jest.advanceTimersByTime(3000);
  await inFlight;

  expect(native).toHaveBeenCalledTimes(1);
});

test('every request queued before the signal is released, not just the first', async () => {
  const a = patched(`${ORIGIN}/api/media/gallery`);
  const b = patched(`${ORIGIN}/api/tasks`);
  const c = patched(`${ORIGIN}/api/me`);
  await Promise.resolve();
  expect(native).not.toHaveBeenCalled();

  ctx.setApiAuthToken('jwt-abc');
  ctx.markAuthSettled();
  await Promise.all([a, b, c]);

  expect(native).toHaveBeenCalledTimes(3);
  for (const call of native.mock.calls) expect(authOf(call)).toBe('Bearer jwt-abc');
});

test('an Authorization the caller already set is left alone', async () => {
  ctx.setApiAuthToken('jwt-abc');
  ctx.markAuthSettled();

  patched(`${ORIGIN}/api/tasks`, { headers: { Authorization: 'Bearer caller-supplied' } });
  expect(authOf(native.mock.calls[0])).toBe('Bearer caller-supplied');
});

test('markAuthSettled is idempotent', async () => {
  const inFlight = patched(`${ORIGIN}/api/tasks`);
  ctx.markAuthSettled();
  ctx.markAuthSettled();
  await inFlight;
  expect(native).toHaveBeenCalledTimes(1);
  expect(ctx.isAuthSettled()).toBe(true);
});
