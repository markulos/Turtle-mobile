/**
 * Token resolution is shared, not merely cached.
 *
 * The result cache never helped the case that cost anything: two effects ask
 * for the token as the app starts, both find the cache empty, and both make the
 * native call. Prod telemetry — 79 /--/api/v2/push/getExpoPushToken calls
 * across 32 cold starts, p50 685ms — is that race, once per launch, forever.
 */
const mockGetExpoPushTokenAsync = jest.fn();

jest.mock('expo-notifications', () => ({
  getExpoPushTokenAsync: (...a) => mockGetExpoPushTokenAsync(...a),
}));
// __esModule matters: vaultPush uses a DEFAULT import, and without this flag
// babel's interop hands it the whole mock object, expoConfig reads undefined,
// and the module quietly falls back to its hard-coded project id — so the
// assertion below would be testing the fallback rather than the config path.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { eas: { projectId: 'test-project' } } } },
}));

const { getExpoPushTokenSafe, _resetPushTokenCacheForTests } = require('../vaultPush');

/** A resolution the test controls the timing of, like a real native call. */
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

beforeEach(() => {
  mockGetExpoPushTokenAsync.mockReset();
  _resetPushTokenCacheForTests();
});

test('resolves the token and hands back the data field', async () => {
  mockGetExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[abc]' });
  await expect(getExpoPushTokenSafe()).resolves.toBe('ExponentPushToken[abc]');
});

test('a second call after success costs no native round-trip', async () => {
  mockGetExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[abc]' });
  await getExpoPushTokenSafe();
  await getExpoPushTokenSafe();
  await getExpoPushTokenSafe();
  expect(mockGetExpoPushTokenAsync).toHaveBeenCalledTimes(1);
});

test('CONCURRENT callers share one native call — the launch-time race', async () => {
  const d = deferred();
  mockGetExpoPushTokenAsync.mockReturnValue(d.promise);

  // Exactly the shape of the real thing: two mount effects, same tick, neither
  // aware of the other. Before the in-flight share this was two native calls.
  const a = getExpoPushTokenSafe();
  const b = getExpoPushTokenSafe();
  const c = getExpoPushTokenSafe();

  expect(mockGetExpoPushTokenAsync).toHaveBeenCalledTimes(1);

  d.resolve({ data: 'ExponentPushToken[abc]' });
  await expect(Promise.all([a, b, c])).resolves.toEqual([
    'ExponentPushToken[abc]',
    'ExponentPushToken[abc]',
    'ExponentPushToken[abc]',
  ]);
  expect(mockGetExpoPushTokenAsync).toHaveBeenCalledTimes(1);
});

test('a throw becomes null rather than propagating', async () => {
  mockGetExpoPushTokenAsync.mockRejectedValue(new Error('remote push not supported'));
  await expect(getExpoPushTokenSafe()).resolves.toBeNull();
});

test('a missing data field becomes null', async () => {
  mockGetExpoPushTokenAsync.mockResolvedValue({});
  await expect(getExpoPushTokenSafe()).resolves.toBeNull();
});

test('a FAILURE is retried later — push can become available mid-session', async () => {
  // Permission granted after the first ask, or the dev build finally landing.
  // Caching the "no" for the life of the process would mean never noticing.
  mockGetExpoPushTokenAsync.mockRejectedValueOnce(new Error('permission'));
  await expect(getExpoPushTokenSafe()).resolves.toBeNull();

  mockGetExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[later]' });
  await expect(getExpoPushTokenSafe()).resolves.toBe('ExponentPushToken[later]');
  expect(mockGetExpoPushTokenAsync).toHaveBeenCalledTimes(2);
});

test('concurrent callers during a FAILING resolution still share it', async () => {
  const d = deferred();
  mockGetExpoPushTokenAsync.mockReturnValue(d.promise);

  const a = getExpoPushTokenSafe();
  const b = getExpoPushTokenSafe();
  d.reject(new Error('nope'));

  await expect(Promise.all([a, b])).resolves.toEqual([null, null]);
  expect(mockGetExpoPushTokenAsync).toHaveBeenCalledTimes(1);
});

test('the project id from app config is what gets sent', async () => {
  mockGetExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[abc]' });
  await getExpoPushTokenSafe();
  expect(mockGetExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'test-project' });
});
