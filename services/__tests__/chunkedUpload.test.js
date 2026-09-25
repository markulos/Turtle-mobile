/**
 * The resumable uploader. What matters here is not "does it POST" — it is that
 * a part which fails costs a part, that the server's `expected` is obeyed
 * rather than argued with, and that the percentage only counts bytes the
 * server has actually acknowledged.
 *
 * The parts go through expo-file-system's NATIVE multipart uploader, not
 * fetch: React Native cannot put bytes in a FormData (a Blob built from a
 * typed array throws, and a Blob inside FormData is dropped by the native
 * layer), so a slice is staged as its own file and sent by URI. These mocks
 * are that surface — createUploadTask + the scratch file around it — so a
 * regression back to a Blob would fail here rather than only on a phone.
 */
const mockReadAsStringAsync = jest.fn();
const mockWriteAsStringAsync = jest.fn();
const mockDeleteAsync = jest.fn();
const mockCreateUploadTask = jest.fn();
jest.mock('expo-file-system/legacy', () => ({
  EncodingType: { Base64: 'base64' },
  FileSystemUploadType: { MULTIPART: 'multipart' },
  cacheDirectory: 'file:///cache/',
  readAsStringAsync: (...a) => mockReadAsStringAsync(...a),
  writeAsStringAsync: (...a) => mockWriteAsStringAsync(...a),
  deleteAsync: (...a) => mockDeleteAsync(...a),
  createUploadTask: (...a) => mockCreateUploadTask(...a),
}));

import { chunkedUpload, newUploadId, CHUNK_BYTES } from '../chunkedUpload';

const OK_PART = { status: 200, body: JSON.stringify({ success: true, received: 1 }) };
const okFinish = (media = { id: 'm1' }) => ({ ok: true, status: 200, json: async () => ({ success: true, media }) });

/**
 * Stand in for the native uploader. `respond(url, options)` returns either an
 * upload result ({ status, body }) or throws to play a transport failure; the
 * calls it saw are recorded for the assertions.
 */
const partUploads = [];
const mockParts = (respond) => {
  mockCreateUploadTask.mockImplementation((url, fileUri, options) => ({
    uploadAsync: async () => {
      partUploads.push({ url, fileUri, options });
      return respond(url, options);
    },
    cancelAsync: async () => {},
  }));
};

beforeEach(() => {
  jest.clearAllMocks();
  partUploads.length = 0;
  // One byte of base64 per slice is plenty — nothing here inspects the payload.
  mockReadAsStringAsync.mockResolvedValue('AA==');
  mockWriteAsStringAsync.mockResolvedValue(undefined);
  mockDeleteAsync.mockResolvedValue(undefined);
  mockParts(() => OK_PART);
  // Only /finish goes through fetch now.
  global.fetch = jest.fn(async () => okFinish());
});

const args = (over = {}) => ({
  baseUrl: 'https://pond.example',
  fileUri: 'file:///docs/big.pdf',
  fileSize: 3 * CHUNK_BYTES,
  originalName: 'big.pdf',
  mimeType: 'application/pdf',
  parameters: { tags: '[]', folderId: 'fld_a' },
  token: 't0k3n',
  label: 'big.pdf',
  ...over,
});

describe('chunkedUpload', () => {
  it('sends the file in order and finishes with the metadata the ingest reads', async () => {
    const pct = [];
    const result = await chunkedUpload(args({ onProgress: (p) => pct.push(p) }));

    expect(partUploads).toHaveLength(3);
    expect(partUploads.every((c) => c.url === 'https://pond.example/api/media/upload/part')).toBe(true);
    expect(partUploads.map((c) => c.options.parameters.index)).toEqual(['0', '1', '2']);
    // A part travels as a FILE, by URI — the one shape React Native carries.
    expect(partUploads.map((c) => c.fileUri)).toEqual(
      mockWriteAsStringAsync.mock.calls.map((c) => c[0]),
    );
    expect(partUploads[0].options).toMatchObject({
      httpMethod: 'POST',
      uploadType: 'multipart',
      fieldName: 'chunk',
      headers: { Authorization: 'Bearer t0k3n' },
    });
    // One id for the whole file — it is what ties the parts into an assembly.
    const ids = new Set(partUploads.map((c) => c.options.parameters.uploadId));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toMatch(/^[a-f0-9]{32}$/);

    // Slices, not the whole file: only a chunk is ever in memory.
    expect(mockReadAsStringAsync).toHaveBeenCalledWith(
      'file:///docs/big.pdf',
      expect.objectContaining({ position: 0, length: CHUNK_BYTES, encoding: 'base64' }),
    );
    expect(mockReadAsStringAsync.mock.calls[2][1].position).toBe(2 * CHUNK_BYTES);
    // Every scratch slice is reclaimed; a 4 MB leak per part is not acceptable
    // on a phone.
    expect(mockDeleteAsync).toHaveBeenCalledTimes(3);

    const finish = global.fetch.mock.calls.find(([url]) => url.endsWith('/finish'));
    const body = JSON.parse(finish[1].body);
    expect(body).toMatchObject({
      originalName: 'big.pdf',
      mimeType: 'application/pdf',
      tags: '[]',
      folderId: 'fld_a',
    });
    expect(body.uploadId).toBe([...ids][0]);
    expect(result).toMatchObject({ success: true });
    // Progress only reaches 100 at /finish; parts are capped at 99 so the bar
    // never claims to be done while the server still has work.
    expect(pct[pct.length - 1]).toBe(100);
    expect(Math.max(...pct.slice(0, -1))).toBeLessThanOrEqual(99);
  });

  // The whole point. A dropped connection costs ONE part.
  it('retries a failed part without restarting the file', async () => {
    let partAttempts = 0;
    mockParts(() => {
      partAttempts += 1;
      if (partAttempts === 2) throw new Error('Network request failed');
      return OK_PART;
    });

    await chunkedUpload(args({ fileSize: 2 * CHUNK_BYTES }));

    // 2 parts + 1 retry of the second = 3 attempts, not a restart from part 0.
    expect(partAttempts).toBe(3);
  });

  /**
   * The failure this module was written for, at part scale: bytes flow for a
   * moment and then nothing. The part has to be given up on and re-sent — a
   * transfer that sits on a dead socket forever is exactly the "stuck at 2%"
   * the whole-file path produced.
   */
  it('gives up on a part that stops moving and re-sends it', async () => {
    jest.useFakeTimers();
    try {
      let attempt = 0;
      mockCreateUploadTask.mockImplementation(() => ({
        uploadAsync: () => {
          attempt += 1;
          // The first attempt never answers and never reports a byte.
          return attempt === 1 ? new Promise(() => {}) : Promise.resolve(OK_PART);
        },
        cancelAsync: async () => {},
      }));

      const done = chunkedUpload(args({ fileSize: CHUNK_BYTES }));
      // Past the 60 s idle window (watched in 5 s ticks), then past the
      // per-part backoff before the second attempt.
      await jest.advanceTimersByTimeAsync(70_000);
      await jest.advanceTimersByTimeAsync(2_000);

      await expect(done).resolves.toMatchObject({ success: true });
      expect(attempt).toBe(2);
    } finally {
      jest.useRealTimers();
    }
  });

  /**
   * The resume mechanism. The client does not get to decide where it is — the
   * server's `expected` is authoritative, because it is the only side that
   * knows which parts actually landed.
   */
  it('obeys the server’s expected index instead of arguing with it', async () => {
    const sentIndexes = [];
    let resynced = false;
    mockParts((_url, options) => {
      const index = Number(options.parameters.index);
      sentIndexes.push(index);
      // The server has only part 0: it lost the rest with the connection.
      if (index === 2 && !resynced) {
        resynced = true;
        return { status: 409, body: JSON.stringify({ success: false, error: 'OUT_OF_ORDER', expected: 1 }) };
      }
      return OK_PART;
    });

    const anomalies = [];
    await chunkedUpload(args({ fileSize: 3 * CHUNK_BYTES, onAnomaly: (a) => anomalies.push(a) }));

    // It rewinds to 1 and carries on from there — it does not start at 0.
    expect(sentIndexes).toEqual([0, 1, 2, 1, 2]);
    expect(anomalies.some((a) => a.phase === 'chunk-resync' && a.expected === 1)).toBe(true);
  });

  it('gives up on a refusal that retrying cannot fix', async () => {
    mockParts(() => ({ status: 413, body: JSON.stringify({ success: false, error: 'File too large' }) }));

    await expect(chunkedUpload(args())).rejects.toThrow('File too large');
  });

  it('surfaces a rejected finish rather than reporting success', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ success: false, error: 'Failed to process media' }),
    }));

    await expect(chunkedUpload(args({ fileSize: CHUNK_BYTES }))).rejects.toThrow('Failed to process media');
  });

  it('stops immediately when the batch is aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(chunkedUpload(args({ signal: controller.signal }))).rejects.toThrow('Upload cancelled');
    expect(mockCreateUploadTask).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('builds the part and finish URLs off a base that already ends in /api', async () => {
    await chunkedUpload(args({ baseUrl: 'https://pond.example/api', fileSize: CHUNK_BYTES }));

    expect(partUploads[0].url).toBe('https://pond.example/api/media/upload/part');
    expect(global.fetch.mock.calls[0][0]).toBe('https://pond.example/api/media/upload/finish');
  });

  it('mints an id the server will accept', () => {
    expect(newUploadId()).toMatch(/^[a-f0-9]{32}$/);
    expect(newUploadId()).not.toBe(newUploadId());
  });
});
