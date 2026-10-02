// Picking a file on a phone and putting it in the vault: what the vault would
// name it if we said nothing, how an upload's answer is read, and how a raw
// uploader error becomes something worth showing a person.
//
// The amounts and the wording that are specific to a NOTE are tested next to the
// note, in screens/NotesScreen/__tests__/noteAttach.test.js.
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('../streamMultipartUpload', () => ({ streamMultipartUpload: jest.fn() }));

import {
  assetFileName,
  parseUploadResult,
  uploadErrorMessage,
  uploadedName,
} from '../vaultAttach';

beforeEach(() => { jest.clearAllMocks(); });

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
