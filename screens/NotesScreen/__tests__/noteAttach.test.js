// The rules behind "add an attachment": how ids fold together, what the vault
// would name a file if we said nothing, and how an upload's answer is read.
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
const mockStream = jest.fn();
jest.mock('../../../services/streamMultipartUpload', () => ({
  streamMultipartUpload: (...a) => mockStream(...a),
}));
jest.mock('../../TurtleScreen/components/FilesVault/systemFilePick', () => ({
  pickSystemFiles: jest.fn(),
}));

import * as ImagePicker from 'expo-image-picker';
import {
  MAX_NOTE_MEDIA,
  assetFileName,
  attachRoom,
  mergeMediaIds,
  parseUploadResult,
  pickNotePhotos,
  removeMediaId,
  uploadErrorMessage,
  uploadNoteAttachment,
  uploadedName,
} from '../noteAttach';

beforeEach(() => { mockStream.mockReset(); ImagePicker.launchImageLibraryAsync.mockReset(); });

describe('attachRoom', () => {
  it('counts down from the server\'s own cap', () => {
    expect(attachRoom(0)).toBe(MAX_NOTE_MEDIA);
    expect(attachRoom(199)).toBe(1);
  });

  it('never goes negative', () => {
    // A note already at (or somehow past) the cap has no room, not -3 of it.
    expect(attachRoom(MAX_NOTE_MEDIA)).toBe(0);
    expect(attachRoom(MAX_NOTE_MEDIA + 5)).toBe(0);
  });
});

describe('mergeMediaIds', () => {
  it('appends in the order added', () => {
    expect(mergeMediaIds(['a'], ['b', 'c']).ids).toEqual(['a', 'b', 'c']);
  });

  it('never attaches the same file twice', () => {
    expect(mergeMediaIds(['a', 'b'], ['b']).ids).toEqual(['a', 'b']);
  });

  it('coerces and drops blanks', () => {
    expect(mergeMediaIds([1, null, ''], [2]).ids).toEqual(['1', '2']);
  });

  it('caps at the server limit and says how many fell off', () => {
    // Past the cap normalizeMediaIds truncates silently, so the client must
    // know it happened rather than showing a file it is about to lose.
    const existing = Array.from({ length: MAX_NOTE_MEDIA }, (_, i) => `m${i}`);
    const { ids, dropped } = mergeMediaIds(existing, ['x', 'y']);
    expect(ids).toHaveLength(MAX_NOTE_MEDIA);
    expect(ids).not.toContain('x');
    expect(dropped).toBe(2);
  });
});

describe('removeMediaId', () => {
  it('unlinks one and keeps the rest in order', () => {
    expect(removeMediaId(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });

  it('matches across the string/number boundary', () => {
    expect(removeMediaId([1, 2], 1)).toEqual(['2']);
  });
});

describe('assetFileName', () => {
  it('prefers the name the picker reported', () => {
    expect(assetFileName({ fileName: 'IMG_0042.HEIC', uri: 'file:///x/abc.jpg' })).toBe('IMG_0042.HEIC');
  });

  it('falls back to the uri tail, query stripped', () => {
    expect(assetFileName({ uri: 'file:///cache/ImagePicker/abc.jpg?t=1' })).toBe('abc.jpg');
  });

  it('always yields something', () => {
    expect(assetFileName({}, 2)).toBe('attachment-3');
  });
});

describe('uploadedName', () => {
  it('is the basename the multipart part will carry', () => {
    // What multer reports as originalname — a picker UUID, or the staging
    // copy's timestamped name. Compared against the real name to decide
    // whether a rename is worth a request.
    expect(uploadedName('file:///cache/ImagePicker/9F2-4A.jpg')).toBe('9F2-4A.jpg');
    expect(uploadedName('file:///docs/picked-files/1769-0-spec.pdf')).toBe('1769-0-spec.pdf');
    expect(uploadedName('')).toBe('');
  });
});

describe('parseUploadResult', () => {
  const ok = (media) => ({ status: 200, body: JSON.stringify({ success: true, media }) });

  it('pulls the new row out', () => {
    const r = parseUploadResult(ok({
      id: 55, originalName: 'shot.png', type: 'image',
      thumbnailUrl: '/t/55.webp', thumbnailLgUrl: '/t/55-lg.webp',
    }));
    // The id is stringified: it is a number in the media table and a string
    // everywhere the note stores it.
    expect(r).toEqual({
      id: '55', name: 'shot.png', type: 'image',
      thumbnailUrl: '/t/55.webp', thumbnailLgUrl: '/t/55-lg.webp',
    });
  });

  it('rejects a 200 that says it failed', () => {
    const body = JSON.stringify({ success: false, error: 'Unsupported type' });
    expect(() => parseUploadResult({ status: 200, body })).toThrow('Unsupported type');
  });

  it('rejects an answer with no id — there would be nothing to attach', () => {
    expect(() => parseUploadResult(ok({ thumbnailUrl: '/t/x.webp' }))).toThrow(/did not return an id/);
    expect(() => parseUploadResult({ status: 200, body: 'not json' })).toThrow(/did not return an id/);
  });
});

describe('uploadErrorMessage', () => {
  it('turns transport diagnostics into something worth showing', () => {
    expect(uploadErrorMessage(new Error('HTTP 413: <body>'))).toBe('Too large for this pond.');
    expect(uploadErrorMessage(new Error('HTTP 401: nope'))).toBe('The pond refused it — sign in again?');
    expect(uploadErrorMessage(new Error('HTTP 500: boom'))).toBe('The pond could not store it.');
    expect(uploadErrorMessage(new Error('stalled during transfer — no progress for 60s'))).toBe('Stalled — check the connection.');
  });

  it('keeps an unrecognised message, bounded', () => {
    expect(uploadErrorMessage(new Error('Network request failed'))).toBe('Network request failed');
    expect(uploadErrorMessage(new Error('x'.repeat(400)))).toHaveLength(120);
    expect(uploadErrorMessage(null)).toBe('Upload failed.');
  });
});

describe('pickNotePhotos', () => {
  it('asks the system picker to enforce the remaining room', () => {
    ImagePicker.launchImageLibraryAsync.mockResolvedValue({ canceled: true });
    return pickNotePhotos({ room: 3 }).then(() => {
      const opts = ImagePicker.launchImageLibraryAsync.mock.calls[0][0];
      expect(opts.selectionLimit).toBe(3);
      expect(opts.allowsMultipleSelection).toBe(true);
      // Images only: a note renders a video as a named chip and the in-note
      // viewer only pages pictures, so picking one here would be a dead end.
      expect(opts.mediaTypes).toEqual(['images']);
    });
  });

  it('turns off multi-select when there is room for exactly one', async () => {
    ImagePicker.launchImageLibraryAsync.mockResolvedValue({ canceled: true });
    await pickNotePhotos({ room: 1 });
    expect(ImagePicker.launchImageLibraryAsync.mock.calls[0][0].allowsMultipleSelection).toBe(false);
  });

  it('reports a cancel as a cancel, not an empty pick', async () => {
    ImagePicker.launchImageLibraryAsync.mockResolvedValue({ canceled: true });
    expect(await pickNotePhotos({ room: 5 })).toEqual({ status: 'canceled', assets: [] });
  });

  it('normalises the assets and never exceeds the room', async () => {
    ImagePicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [
        { uri: 'file:///a.jpg', fileName: 'a.jpg', mimeType: 'image/jpeg' },
        { uri: 'file:///b.png' },
      ],
    });
    const r = await pickNotePhotos({ room: 1 });
    expect(r.status).toBe('picked');
    expect(r.assets).toEqual([{ uri: 'file:///a.jpg', fileName: 'a.jpg', mimeType: 'image/jpeg' }]);
  });
});

describe('uploadNoteAttachment', () => {
  const asset = { uri: 'file:///a.jpg', fileName: 'a.jpg', mimeType: 'image/jpeg' };

  it('streams to the vault as the "media" part, carrying the token by hand', async () => {
    // The native upload task bypasses both the api wrapper and the patched
    // fetch, so nothing else would attach the Bearer token.
    mockStream.mockResolvedValue({ status: 200, body: JSON.stringify({ media: { id: '9' } }) });
    const r = await uploadNoteAttachment({
      uploadUrl: 'http://pond/api/media/upload', token: 'jwt', asset, tags: ['Home'],
    });

    expect(r.id).toBe('9');
    const args = mockStream.mock.calls[0][0];
    expect(args.url).toBe('http://pond/api/media/upload');
    expect(args.fieldName).toBe('media');
    expect(args.token).toBe('jwt');
    expect(args.fileUri).toBe('file:///a.jpg');
    // Tagged at upload so the file is never untagged in the vault, even if the
    // note it was picked for is abandoned.
    expect(args.parameters).toEqual({ tags: JSON.stringify(['Home']) });
  });

  it('sends no tags parameter when the note has none', async () => {
    mockStream.mockResolvedValue({ status: 200, body: JSON.stringify({ media: { id: '9' } }) });
    await uploadNoteAttachment({ uploadUrl: 'u', token: 't', asset, tags: [] });
    expect(mockStream.mock.calls[0][0].parameters).toEqual({});
  });

  it('lets the uploader\'s error through for the caller to translate', async () => {
    mockStream.mockRejectedValue(new Error('HTTP 413: too big'));
    await expect(uploadNoteAttachment({ uploadUrl: 'u', token: 't', asset })).rejects.toThrow('HTTP 413');
  });
});
