import {
  SINGLE_BODY_MAX_BYTES,
  chooseUploadTransport,
  chunkedBaseUrlOf,
  isMediaUploadUrl,
} from '../uploadTransport';

const MB = 1024 * 1024;
const UPLOAD = 'https://app.t3d.ca/api/media/upload';

describe('chooseUploadTransport', () => {
  it('sends the 184 MB thesis in parts — the body that stalled at 4 MB on every attempt', () => {
    expect(chooseUploadTransport({ url: UPLOAD, sizeBytes: 184414492 })).toEqual({
      mode: 'chunked',
      baseUrl: 'https://app.t3d.ca/api',
      sizeBytes: 184414492,
    });
  });

  it('keeps photos and ordinary phone videos on the one-request path', () => {
    expect(chooseUploadTransport({ url: UPLOAD, sizeBytes: 2 * MB })).toEqual({ mode: 'single' });
    expect(chooseUploadTransport({ url: UPLOAD, sizeBytes: 40 * MB })).toEqual({ mode: 'single' });
  });

  it('draws the line exactly at the single-body ceiling', () => {
    expect(chooseUploadTransport({ url: UPLOAD, sizeBytes: SINGLE_BODY_MAX_BYTES }).mode).toBe('single');
    expect(chooseUploadTransport({ url: UPLOAD, sizeBytes: SINGLE_BODY_MAX_BYTES + 1 }).mode).toBe('chunked');
  });

  it('sits under the tunnel’s 100 MB body ceiling with room for the multipart framing', () => {
    expect(SINGLE_BODY_MAX_BYTES).toBeLessThan(100 * 1000 * 1000);
    expect(SINGLE_BODY_MAX_BYTES).toBeGreaterThanOrEqual(32 * MB);
  });

  it('falls back to one body when the size is unknown — what has always happened', () => {
    expect(chooseUploadTransport({ url: UPLOAD }).mode).toBe('single');
    expect(chooseUploadTransport({ url: UPLOAD, sizeBytes: 0 }).mode).toBe('single');
    expect(chooseUploadTransport({ url: UPLOAD, sizeBytes: null }).mode).toBe('single');
    expect(chooseUploadTransport({ url: UPLOAD, sizeBytes: 'lots' }).mode).toBe('single');
  });

  it('never chunks a route that does not speak the part protocol', () => {
    expect(chooseUploadTransport({ url: 'https://app.t3d.ca/api/transcriptions', fieldName: 'file', sizeBytes: 500 * MB }).mode).toBe('single');
    expect(chooseUploadTransport({ url: 'https://app.t3d.ca/api/transcriptions', sizeBytes: 500 * MB }).mode).toBe('single');
    // The vault ingest, but under another field name: not the protocol either.
    expect(chooseUploadTransport({ url: UPLOAD, fieldName: 'file', sizeBytes: 500 * MB }).mode).toBe('single');
  });

  it('accepts a base that already ends in /api and one that does not', () => {
    expect(chooseUploadTransport({ url: 'http://100.85.19.127:3000/api/media/upload', sizeBytes: 200 * MB }).baseUrl)
      .toBe('http://100.85.19.127:3000/api');
    expect(chooseUploadTransport({ url: 'https://pond.example/media/upload', sizeBytes: 200 * MB }).baseUrl)
      .toBe('https://pond.example');
  });
});

describe('isMediaUploadUrl / chunkedBaseUrlOf', () => {
  it('matches the vault ingest with or without a trailing slash or query', () => {
    expect(isMediaUploadUrl(UPLOAD)).toBe(true);
    expect(isMediaUploadUrl(`${UPLOAD}/`)).toBe(true);
    expect(isMediaUploadUrl(`${UPLOAD}?x=1`)).toBe(true);
    expect(isMediaUploadUrl('https://app.t3d.ca/api/media/upload/part')).toBe(false);
    expect(isMediaUploadUrl('https://app.t3d.ca/api/transcriptions')).toBe(false);
    expect(isMediaUploadUrl(undefined)).toBe(false);
  });

  it('strips exactly the ingest path', () => {
    expect(chunkedBaseUrlOf(UPLOAD)).toBe('https://app.t3d.ca/api');
    expect(chunkedBaseUrlOf(`${UPLOAD}?x=1`)).toBe('https://app.t3d.ca/api');
  });
});
