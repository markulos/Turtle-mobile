/**
 * shareLink — one link, one activity item.
 *
 * The regression these lock down is visible and embarrassing: sharing an album
 * link opened the iOS sheet titled "2 Links", because the old call passed the
 * same URL as BOTH `message` and `url` and React Native appends one activity
 * item per field. The assertion that matters in every iOS case below is
 * therefore about what is ABSENT.
 */
import { Platform, Share } from 'react-native';
import shareLink from '../shareLink';

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  Share: { share: jest.fn(async () => ({ action: 'sharedAction' })) },
}));

const contentOf = () => Share.share.mock.calls[0][0];
const optionsOf = () => Share.share.mock.calls[0][1];

beforeEach(() => {
  Share.share.mockClear();
  Platform.OS = 'ios';
});

describe('shareLink on iOS', () => {
  it('hands the sheet the url and NOTHING else — one item, not two', async () => {
    await shareLink('https://s.t3d.ca/s/PEELn9Z');
    expect(contentOf()).toEqual({ url: 'https://s.t3d.ca/s/PEELn9Z' });
    // The whole bug: a `message` alongside `url` is a second activity item.
    expect(contentOf().message).toBeUndefined();
  });

  it('carries a title as metadata without it becoming a second item', async () => {
    await shareLink('https://s.t3d.ca/s/abc', { title: 'Turtle 3D' });
    expect(contentOf()).toEqual({ url: 'https://s.t3d.ca/s/abc', title: 'Turtle 3D' });
    expect(contentOf().message).toBeUndefined();
    expect(optionsOf()).toEqual({ subject: 'Turtle 3D', dialogTitle: 'Turtle 3D' });
  });

  it('passes no options at all when there is no title', async () => {
    await shareLink('https://s.t3d.ca/s/abc');
    expect(optionsOf()).toBeUndefined();
  });
});

describe('shareLink on Android', () => {
  it('hands the sheet the message, since Android ignores url outright', async () => {
    Platform.OS = 'android';
    await shareLink('https://s.t3d.ca/s/abc');
    expect(contentOf()).toEqual({ message: 'https://s.t3d.ca/s/abc' });
    expect(contentOf().url).toBeUndefined();
  });
});

describe('shareLink with nothing to share', () => {
  it.each([['', 'empty'], ['   ', 'whitespace'], [null, 'null'], [undefined, 'undefined'], [42, 'a number']])(
    'opens no sheet for %p (%s)',
    async (value) => {
      await expect(shareLink(value)).resolves.toBeNull();
      expect(Share.share).not.toHaveBeenCalled();
    },
  );

  it('trims a padded url rather than sharing the padding', async () => {
    await shareLink('  https://s.t3d.ca/s/abc  ');
    expect(contentOf()).toEqual({ url: 'https://s.t3d.ca/s/abc' });
  });
});
