import {
  MAX_PINS, PINS_KEY, loadPins, normalizePins, savePins,
} from '../focusPins';

/**
 * The pinned focus tasks, remembered on this phone.
 *
 * A pin has to survive leaving the tab and leaving the app, which makes it a
 * preference rather than a view's state. What is worth pinning here is that
 * storage which will not answer costs you a list of five ids and never the
 * Focus tab.
 */

const store = (over = {}) => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => {}),
  ...over,
});

describe('normalizePins', () => {
  test('ids only — junk in storage is dropped, not rendered', () => {
    expect(normalizePins(['a', 2, null, '', 'b', { id: 'c' }])).toEqual(['a', 'b']);
  });

  test('…and the same id twice is one pin', () => {
    expect(normalizePins(['a', 'a', 'b'])).toEqual(['a', 'b']);
  });

  test('capped, because "pinned to the top" stops meaning anything past a few', () => {
    const many = Array.from({ length: MAX_PINS + 6 }, (_, i) => `t${i}`);
    expect(normalizePins(many)).toHaveLength(MAX_PINS);
  });

  test('anything that is not a list is no pins at all', () => {
    for (const junk of [null, undefined, 'a', 7, {}]) expect(normalizePins(junk)).toEqual([]);
  });
});

describe('loadPins', () => {
  test('reads and normalizes what is there', async () => {
    const s = store({ getItem: jest.fn(async () => JSON.stringify(['a', 'a', 'b'])) });
    await expect(loadPins(s)).resolves.toEqual(['a', 'b']);
    expect(s.getItem).toHaveBeenCalledWith(PINS_KEY);
  });

  test('NOTHING STORED IS NO PINS, not a crash', async () => {
    await expect(loadPins(store())).resolves.toEqual([]);
  });

  test('…and neither is corrupt JSON, or storage that throws', async () => {
    await expect(loadPins(store({ getItem: jest.fn(async () => '{oh dear') }))).resolves.toEqual([]);
    await expect(loadPins(store({ getItem: jest.fn(async () => { throw new Error('nope'); }) })))
      .resolves.toEqual([]);
  });
});

describe('savePins', () => {
  test('writes the normalized list under the one key', async () => {
    const s = store();
    await expect(savePins(['a', 'a'], s)).resolves.toBe(true);
    expect(s.setItem).toHaveBeenCalledWith(PINS_KEY, JSON.stringify(['a']));
  });

  test('a write that fails is reported, not thrown', async () => {
    // The caller is a setState updater. A throw there takes the tab down
    // over a list of five ids.
    const s = store({ setItem: jest.fn(async () => { throw new Error('full'); }) });
    await expect(savePins(['a'], s)).resolves.toBe(false);
  });
});
