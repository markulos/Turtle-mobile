// The rules a message's photos follow. Kept in lockstep with the web app's
// components/messages/messageAttachments.test.ts — the two clients write to the
// same endpoint and must not disagree about the cap or about what an empty
// message is.
import {
  MAX_MESSAGE_ATTACHMENTS,
  appendDraftPhoto,
  attachmentIdsOf,
  attachmentRoom,
  attachmentSummary,
  canSendMessage,
  messagePreviewLine,
  removeDraftPhoto,
  toAttachments,
} from '../messageAttachments';

const media = (mediaId) => ({ type: 'media', mediaId });

describe('attachmentIdsOf', () => {
  it('reads the ids in order', () => {
    expect(attachmentIdsOf({ attachments: [media('a'), media('b')] })).toEqual(['a', 'b']);
  });

  it('is empty for a message carrying none', () => {
    expect(attachmentIdsOf({})).toEqual([]);
    expect(attachmentIdsOf(null)).toEqual([]);
    expect(attachmentIdsOf({ attachments: null })).toEqual([]);
  });

  it('survives a shape it does not recognise', () => {
    // The server returns [] for anything it cannot parse rather than failing,
    // because the WORDS of a message must still arrive. Same instinct here.
    expect(attachmentIdsOf({ attachments: 'nonsense' })).toEqual([]);
    expect(attachmentIdsOf({ attachments: [null, undefined, {}] })).toEqual([]);
  });

  it('accepts a bare id string, the other shape the server tolerates', () => {
    expect(attachmentIdsOf({ attachments: ['a', media('b')] })).toEqual(['a', 'b']);
  });

  it('dedupes', () => {
    expect(attachmentIdsOf({ attachments: [media('a'), media('a')] })).toEqual(['a']);
  });
});

describe('toAttachments', () => {
  it('builds the POST body shape, and round-trips', () => {
    expect(toAttachments(['a'])).toEqual([{ type: 'media', mediaId: 'a' }]);
    expect(attachmentIdsOf({ attachments: toAttachments(['x', 'y']) })).toEqual(['x', 'y']);
  });
});

describe('attachmentRoom', () => {
  it('counts down from the cap and never goes negative', () => {
    expect(attachmentRoom([])).toBe(MAX_MESSAGE_ATTACHMENTS);
    expect(attachmentRoom(['a', 'b'])).toBe(MAX_MESSAGE_ATTACHMENTS - 2);
    expect(attachmentRoom(new Array(MAX_MESSAGE_ATTACHMENTS + 3).fill('x'))).toBe(0);
  });
});

describe('appendDraftPhoto / removeDraftPhoto', () => {
  it('adds to the end', () => {
    expect(appendDraftPhoto([{ id: 'a' }], { id: 'b' })).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('refuses a photo already on the draft', () => {
    const list = [{ id: 'a' }];
    expect(appendDraftPhoto(list, { id: 'a' })).toBe(list);
  });

  it('refuses one past the cap — the backstop for two uploads landing together', () => {
    const full = Array.from({ length: MAX_MESSAGE_ATTACHMENTS }, (_, i) => ({ id: `id${i}` }));
    expect(appendDraftPhoto(full, { id: 'extra' })).toBe(full);
  });

  it('ignores an entry with no id, which is an upload that never finished', () => {
    const list = [{ id: 'a' }];
    expect(appendDraftPhoto(list, { uploading: true })).toBe(list);
  });

  it('takes one back off', () => {
    expect(removeDraftPhoto([{ id: 'a' }, { id: 'b' }], 'a')).toEqual([{ id: 'b' }]);
    expect(removeDraftPhoto([], 'a')).toEqual([]);
  });
});

describe('canSendMessage', () => {
  it('is false with nothing at all', () => {
    expect(canSendMessage('', [])).toBe(false);
    expect(canSendMessage('   \n ', [])).toBe(false);
  });

  it('is true for words alone', () => {
    expect(canSendMessage('hello', [])).toBe(true);
  });

  it('A PHOTO IS A MESSAGE — true for a photo with no words', () => {
    // The server refuses only when BOTH are empty. A send key that stayed dark
    // here would refuse the one thing people most often send on its own.
    expect(canSendMessage('', ['m1'])).toBe(true);
    expect(canSendMessage('   ', ['m1'])).toBe(true);
  });
});

describe('attachmentSummary / messagePreviewLine', () => {
  it('names one photo and several', () => {
    expect(attachmentSummary(1)).toBe('Photo');
    expect(attachmentSummary(3)).toBe('3 photos');
  });

  it('is blank for nothing, so a caller falls through to the text', () => {
    expect(attachmentSummary(0)).toBe('');
    expect(attachmentSummary(Number.NaN)).toBe('');
  });

  it('prefers the words, and describes the photos when there are none', () => {
    expect(messagePreviewLine({ content: 'look', attachments: [media('a')] })).toBe('look');
    expect(messagePreviewLine({ content: '', attachments: [media('a')] })).toBe('Photo');
    expect(messagePreviewLine({ content: '  ', attachments: [media('a'), media('b')] })).toBe('2 photos');
    expect(messagePreviewLine({ content: '' })).toBe('');
  });
});
