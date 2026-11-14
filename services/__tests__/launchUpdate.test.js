jest.mock('expo-updates', () => ({ isEnabled: true }));

import {
  RECHECK_AFTER_MS, __resetLaunchUpdate, checkAndDownload, lastLaunchCheckAt, launchCheckSettled,
  shouldRecheck,
} from '../launchUpdate';
import { __resetAttention, getAttention } from '../../utils/attention';

/**
 * The quiet update check: found → downloaded → waiting for the next launch.
 *
 * The thing worth pinning is what it must NEVER do — apply the update. A
 * reload in the middle of a session yanks the screen out from under whoever
 * is using it; the whole design is that the new bundle is simply there the
 * next time the app opens.
 */

const updatesWith = ({ available = true, fetch = jest.fn(async () => ({ isNew: true })) } = {}) => ({
  isEnabled: true,
  checkForUpdateAsync: jest.fn(async () => ({ isAvailable: available })),
  fetchUpdateAsync: fetch,
  reloadAsync: jest.fn(),
});

beforeEach(() => {
  __resetLaunchUpdate();
  __resetAttention();
});

test('a newer update is downloaded, and NOT applied', async () => {
  const updates = updatesWith();
  await expect(checkAndDownload({ updates, isDev: false })).resolves.toBe('ready');
  expect(updates.fetchUpdateAsync).toHaveBeenCalledTimes(1);
  expect(updates.reloadAsync).not.toHaveBeenCalled();
  // …and the Profile tab's dot says it is waiting.
  expect(getAttention().update).toBe('ready');
});

test('nothing newer: nothing is fetched and the dot stays out', async () => {
  const updates = updatesWith({ available: false });
  await expect(checkAndDownload({ updates, isDev: false })).resolves.toBe('current');
  expect(updates.fetchUpdateAsync).not.toHaveBeenCalled();
  expect(getAttention().update).toBe('none');
});

test('a dev client, or a build with updates off, calls nothing at all', async () => {
  // Every Updates API throws in a dev client.
  const dev = updatesWith();
  await expect(checkAndDownload({ updates: dev, isDev: true })).resolves.toBe('skipped');
  expect(dev.checkForUpdateAsync).not.toHaveBeenCalled();

  const off = { ...updatesWith(), isEnabled: false };
  await expect(checkAndDownload({ updates: off, isDev: false })).resolves.toBe('skipped');
  expect(off.checkForUpdateAsync).not.toHaveBeenCalled();
});

test('offline, or a pond that is down, is swallowed', async () => {
  const updates = {
    isEnabled: true,
    checkForUpdateAsync: jest.fn(async () => { throw new Error('Network request failed'); }),
    fetchUpdateAsync: jest.fn(),
  };
  await expect(checkAndDownload({ updates, isDev: false })).resolves.toBe('error');
  expect(getAttention().update).toBe('none');
});

test('a download that fails leaves the update "available", not "ready"', async () => {
  const updates = updatesWith({ fetch: jest.fn(async () => { throw new Error('dropped'); }) });
  await expect(checkAndDownload({ updates, isDev: false })).resolves.toBe('error');
  expect(getAttention().update).toBe('available');
});

test('two callers at once share ONE check and one download', async () => {
  let release;
  const fetch = jest.fn(() => new Promise((r) => { release = () => r({ isNew: true }); }));
  const updates = updatesWith({ fetch });
  const a = checkAndDownload({ updates, isDev: false });
  const b = checkAndDownload({ updates, isDev: false });
  await Promise.resolve();
  await Promise.resolve();
  release();
  await expect(Promise.all([a, b])).resolves.toEqual(['ready', 'ready']);
  expect(updates.checkForUpdateAsync).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('the updates panel can wait out a download in flight — and never on a failure', async () => {
  // expo-updates will not run two fetches at once, so "Download & restart"
  // pressed mid-download waits for this one instead of erroring.
  await expect(launchCheckSettled()).resolves.toBeUndefined();

  let fail;
  const fetch = jest.fn(() => new Promise((_, rej) => { fail = () => rej(new Error('dropped')); }));
  const run = checkAndDownload({ updates: updatesWith({ fetch }), isDev: false });
  await Promise.resolve();
  await Promise.resolve();
  const settled = launchCheckSettled();
  fail();
  await expect(settled).resolves.toBeUndefined();
  await run;
});

test('the foreground re-check is rate-limited to the last check', async () => {
  expect(shouldRecheck(0, 5_000)).toBe(true); // never checked
  expect(shouldRecheck(1_000, 1_000 + RECHECK_AFTER_MS - 1)).toBe(false);
  expect(shouldRecheck(1_000, 1_000 + RECHECK_AFTER_MS)).toBe(true);

  await checkAndDownload({ updates: updatesWith({ available: false }), isDev: false, now: () => 42_000 });
  expect(lastLaunchCheckAt()).toBe(42_000);
});
