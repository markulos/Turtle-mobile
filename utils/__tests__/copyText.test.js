import { Share } from 'react-native';
import { copyText } from '../copyText';

const mockSetString = jest.fn();
jest.mock('expo-clipboard', () => ({ setStringAsync: (...a) => mockSetString(...a) }), { virtual: true });

describe('copyText', () => {
  let share;

  beforeEach(() => {
    mockSetString.mockReset().mockResolvedValue(undefined);
    share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
  });
  afterEach(() => share.mockRestore());

  test('uses the clipboard when the native module is there', async () => {
    await expect(copyText('take me')).resolves.toBe('copied');
    expect(mockSetString).toHaveBeenCalledWith('take me');
    expect(share).not.toHaveBeenCalled();
  });

  // The reason this helper exists: expo-clipboard is native, so a binary built
  // before the dependency landed has no such module. Sharing is the degrade
  // path, NOT a crash on import.
  test('falls back to the share sheet when the clipboard refuses', async () => {
    mockSetString.mockRejectedValue(new Error('no native module'));
    await expect(copyText('take me')).resolves.toBe('shared');
    expect(share).toHaveBeenCalledWith({ message: 'take me' });
  });

  test('reports nothing happened when the share sheet was dismissed', async () => {
    mockSetString.mockRejectedValue(new Error('nope'));
    share.mockResolvedValue({ action: Share.dismissedAction });
    await expect(copyText('take me')).resolves.toBe('none');
  });

  test('reports nothing happened when sharing throws outright', async () => {
    mockSetString.mockRejectedValue(new Error('nope'));
    share.mockRejectedValue(new Error('no share either'));
    await expect(copyText('take me')).resolves.toBe('none');
  });

  // An empty share sheet is worse than doing nothing, so this never opens one.
  test.each([['', 'empty string'], [null, 'null'], [undefined, 'undefined']])(
    'refuses to copy %p (%s) and opens nothing',
    async (value) => {
      await expect(copyText(value)).resolves.toBe('none');
      expect(mockSetString).not.toHaveBeenCalled();
      expect(share).not.toHaveBeenCalled();
    },
  );

  test('stringifies a non-string rather than copying "[object Object]" silently', async () => {
    await expect(copyText(42)).resolves.toBe('copied');
    expect(mockSetString).toHaveBeenCalledWith('42');
  });
});
