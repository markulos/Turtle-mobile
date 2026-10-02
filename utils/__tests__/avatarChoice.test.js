/**
 * The animal choice: remembered on the device, mirrored to the pond.
 *
 * The behaviour worth pinning is the PRECEDENCE. A pick is written locally
 * first and the pond is told behind it, so the pond's own answer arriving a
 * moment later must not undo it — that race is real (the Profile screen
 * re-reads /me on every tab focus) and it would look like the app forgetting
 * what you just chose.
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  SETTINGS_KEY,
  adoptServerAvatarAnimal,
  myAvatarAnimal,
  setMyAvatarAnimal,
  subscribeAvatarChoice,
  __resetAvatarChoice,
} from '../avatarChoice';

const STORAGE_KEY = 'profile:avatarAnimal';

beforeEach(async () => {
  __resetAvatarChoice();
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe('picking an animal', () => {
  test('it is readable immediately, without awaiting storage', async () => {
    const save = setMyAvatarAnimal('raccoon');
    // SYNCHRONOUS: render paths read this and must never await.
    expect(myAvatarAnimal()).toBe('raccoon');
    await save;
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBe('raccoon');
  });

  test('subscribers hear about it, so every surface updates at once', async () => {
    const heard = [];
    const off = subscribeAvatarChoice(() => heard.push(myAvatarAnimal()));
    await setMyAvatarAnimal('fox');
    await setMyAvatarAnimal('bear');
    off();
    await setMyAvatarAnimal('otter');
    expect(heard).toEqual(['fox', 'bear']);
  });

  test('re-picking the same animal is not an event', async () => {
    await setMyAvatarAnimal('fox');
    const heard = [];
    subscribeAvatarChoice(() => heard.push(1));
    await setMyAvatarAnimal('fox');
    expect(heard).toEqual([]);
  });

  test('it is mirrored to the pond so it follows the person, not the phone', async () => {
    const api = { patch: jest.fn().mockResolvedValue({ success: true }) };
    await setMyAvatarAnimal('raccoon', api);
    expect(api.patch).toHaveBeenCalledWith('/me/settings', { [SETTINGS_KEY]: 'raccoon' });
  });

  test('a pond that refuses the write does not lose the local choice', async () => {
    const api = { patch: jest.fn().mockRejectedValue(new Error('offline')) };
    await setMyAvatarAnimal('raccoon', api);
    expect(myAvatarAnimal()).toBe('raccoon');
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBe('raccoon');
  });

  test('an animal nobody recognises is refused, not stored', async () => {
    await setMyAvatarAnimal('tyrannosaurus');
    expect(myAvatarAnimal()).toBeNull();
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe('going back to the assigned animal', () => {
  test('null clears it locally', async () => {
    await setMyAvatarAnimal('raccoon');
    await setMyAvatarAnimal(null);
    expect(myAvatarAnimal()).toBeNull();
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  test('and sends a null, which DELETES the key rather than storing one', async () => {
    // mergeUserSettings treats null as a removal (server/services/userSettings.js),
    // so "use my assigned animal" leaves no tombstone behind on the pond.
    const api = { patch: jest.fn().mockResolvedValue({ success: true }) };
    await setMyAvatarAnimal('raccoon', api);
    await setMyAvatarAnimal(null, api);
    expect(api.patch).toHaveBeenLastCalledWith('/me/settings', { [SETTINGS_KEY]: null });
  });
});

describe('adopting what the pond already knows', () => {
  test('a fresh device takes the choice made on another one', async () => {
    adoptServerAvatarAnimal({ [SETTINGS_KEY]: 'raccoon' });
    expect(myAvatarAnimal()).toBe('raccoon');
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBe('raccoon');
  });

  test('it NEVER overwrites a choice made on this device', async () => {
    // The race this exists for: Profile re-reads /me on every tab focus, and
    // the answer can still be carrying the old value right after a pick.
    await setMyAvatarAnimal('fox');
    adoptServerAvatarAnimal({ [SETTINGS_KEY]: 'raccoon' });
    expect(myAvatarAnimal()).toBe('fox');
  });

  test('junk from the pond is ignored rather than drawn', () => {
    adoptServerAvatarAnimal({ [SETTINGS_KEY]: 'tyrannosaurus' });
    expect(myAvatarAnimal()).toBeNull();
    adoptServerAvatarAnimal(null);
    adoptServerAvatarAnimal({});
    adoptServerAvatarAnimal('nonsense');
    expect(myAvatarAnimal()).toBeNull();
  });
});
