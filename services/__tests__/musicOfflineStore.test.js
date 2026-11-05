/**
 * The offline music store, against a fake file system.
 *
 * The cases that matter are the ones that would cost someone a track they
 * thought they had, or leave bytes on the phone with nothing on screen able
 * to remove them: a double tap starting two downloads, a failed or cancelled
 * download leaving a half file that looks downloaded forever, and a
 * zero-byte leftover being counted as music on the next boot.
 */
import { createOfflineMusicStore, fileNameFor, formatBytes } from '../musicOfflineStore';

const DIR = 'file:///docs/music-offline/';

/** Enough of expo-file-system/legacy to run the store against. */
function fakeFs({ sizes = {}, failWith = null, status = 200 } = {}) {
  const files = new Map(Object.entries(sizes));
  const calls = { downloads: 0, cancels: 0 };
  // Seeded files mean a previous run left a directory behind — without this
  // load() takes the "no directory yet" branch and never reads them.
  let dirExists = files.size > 0;
  let pending = null;

  return {
    files,
    calls,
    settle: (...args) => pending?.(...args),
    get hasPending() { return !!pending; },

    async getInfoAsync(uri) {
      if (uri === DIR) return { exists: dirExists };
      const name = uri.replace(DIR, '');
      return files.has(name)
        ? { exists: true, size: files.get(name) }
        : { exists: false };
    },
    async makeDirectoryAsync() { dirExists = true; },
    async readDirectoryAsync() { return [...files.keys()]; },
    async deleteAsync(uri) {
      if (uri === DIR) { files.clear(); return; }
      files.delete(uri.replace(DIR, ''));
    },
    createDownloadResumable(url, dest, _opts, onProgress) {
      const name = dest.replace(DIR, '');
      return {
        async downloadAsync() {
          calls.downloads += 1;
          onProgress?.({ totalBytesWritten: 50, totalBytesExpectedToWrite: 100 });
          if (failWith) throw new Error(failWith);
          // A pending download so a test can cancel mid-flight.
          if (status === 'pending') {
            return new Promise((resolve) => { pending = resolve; });
          }
          if (status >= 200 && status < 300) files.set(name, 1000);
          return { status, uri: dest };
        },
        // A real cancelAsync makes the in-flight downloadAsync RESOLVE with
        // no result. Nulling the resolver instead would leave the store
        // awaiting a promise that never settles — which is a bug in the
        // double, not in the thing being tested.
        async cancelAsync() {
          calls.cancels += 1;
          const settle = pending;
          pending = null;
          settle?.(undefined);
        },
      };
    },
  };
}

const store = (fs) => createOfflineMusicStore(fs, DIR);

describe('fileNameFor', () => {
  it('will not let an id climb out of the directory', () => {
    expect(fileNameFor('../../etc/passwd')).not.toContain('/');
    expect(fileNameFor('../../etc/passwd')).not.toContain('..' + '/');
  });

  it('leaves an ordinary id alone', () => {
    expect(fileNameFor('42')).toBe('42');
  });
});

describe('downloading', () => {
  it('keeps the file and reports the track as downloaded', async () => {
    const fs = fakeFs();
    const s = store(fs);

    await expect(s.download('42', 'http://pond/raw/42')).resolves.toBe(true);
    expect(s.isDownloaded('42')).toBe(true);
    expect(s.statusOf('42')).toEqual({ state: 'done', bytes: 1000 });
    expect(s.getSnapshot().totalBytes).toBe(1000);
  });

  it('gives back a file: URI the player can use', async () => {
    const fs = fakeFs();
    const s = store(fs);
    await s.download('42', 'http://pond/raw/42');
    expect(s.localUri('42')).toBe(`${DIR}42`);
    expect(s.localUris()).toEqual({ 42: `${DIR}42` });
  });

  it('reports progress while it arrives', async () => {
    const fs = fakeFs();
    const s = store(fs);
    const seen = [];
    s.subscribe(() => {
      const st = s.statusOf('42');
      if (st.state === 'downloading') seen.push(st.progress);
    });
    await s.download('42', 'http://pond/raw/42');
    expect(seen).toContain(0.5);
  });

  it('a second tap does not start a second download', async () => {
    const fs = fakeFs();
    const s = store(fs);
    await Promise.all([
      s.download('42', 'http://pond/raw/42'),
      s.download('42', 'http://pond/raw/42'),
    ]);
    expect(fs.calls.downloads).toBe(1);
  });

  it('does not refetch something already here', async () => {
    const fs = fakeFs();
    const s = store(fs);
    await s.download('42', 'http://pond/raw/42');
    await s.download('42', 'http://pond/raw/42');
    expect(fs.calls.downloads).toBe(1);
  });

  it('refuses a track with no URL rather than writing an empty file', async () => {
    const fs = fakeFs();
    const s = store(fs);
    await expect(s.download('42', null)).resolves.toBe(false);
    expect(fs.calls.downloads).toBe(0);
  });
});

describe('when it goes wrong', () => {
  it('a 404 leaves no file and says why', async () => {
    const fs = fakeFs({ status: 404 });
    const s = store(fs);

    await expect(s.download('42', 'http://pond/raw/42')).resolves.toBe(false);
    expect(s.isDownloaded('42')).toBe(false);
    expect(fs.files.has('42')).toBe(false);
    expect(s.statusOf('42').state).toBe('failed');
  });

  it('deletes the half file a dead connection left behind', async () => {
    const fs = fakeFs({ failWith: 'Network request failed', sizes: { 42: 120 } });
    const s = store(fs);

    await s.download('42', 'http://pond/raw/42');
    // Left in place it would look downloaded forever, and every later play
    // would hit a truncated track instead of retrying.
    expect(fs.files.has('42')).toBe(false);
    expect(s.statusOf('42')).toEqual({ state: 'failed', error: 'Network request failed' });
  });

  it('retrying clears the previous failure', async () => {
    const bad = fakeFs({ status: 500 });
    const s = store(bad);
    await s.download('42', 'http://pond/raw/42');
    expect(s.statusOf('42').state).toBe('failed');

    const good = store(fakeFs());
    await good.download('42', 'http://pond/raw/42');
    expect(good.statusOf('42').state).toBe('done');
  });

  it('cancelling keeps nothing and is not a failure', async () => {
    const fs = fakeFs({ status: 'pending' });
    const s = store(fs);
    const inFlight = s.download('42', 'http://pond/raw/42');
    // Wait for the request to actually be in flight, which is when someone
    // would reach for Stop. download() awaits makeDirectoryAsync first, so
    // this is a few microtasks after the call, not immediately.
    for (let i = 0; i < 20 && !fs.hasPending; i++) await Promise.resolve();
    expect(s.statusOf('42').state).toBe('downloading');

    await s.cancel('42');
    await inFlight;

    expect(fs.calls.cancels).toBe(1);
    expect(s.isDownloaded('42')).toBe(false);
    // Stopping a download is a choice. A red row would read as a fault.
    expect(s.statusOf('42')).toEqual({ state: 'absent' });
  });
});

describe('removing', () => {
  it('takes the file and its bytes back', async () => {
    const fs = fakeFs();
    const s = store(fs);
    await s.download('42', 'http://pond/raw/42');

    await s.remove('42');
    expect(s.isDownloaded('42')).toBe(false);
    expect(fs.files.has('42')).toBe(false);
    expect(s.getSnapshot().totalBytes).toBe(0);
  });

  it('clear empties the lot', async () => {
    const fs = fakeFs();
    const s = store(fs);
    await s.download('1', 'http://pond/raw/1');
    await s.download('2', 'http://pond/raw/2');
    expect(s.getSnapshot().totalBytes).toBe(2000);

    await s.clear();
    expect(s.getSnapshot().downloaded.size).toBe(0);
    expect(s.getSnapshot().totalBytes).toBe(0);
  });
});

describe('reading the directory on boot', () => {
  it('finds what a previous run downloaded', async () => {
    const s = store(fakeFs({ sizes: { 7: 4096, 9: 2048 } }));
    await s.load();

    expect(s.isDownloaded('7')).toBe(true);
    expect(s.isDownloaded('9')).toBe(true);
    expect(s.getSnapshot().totalBytes).toBe(6144);
    expect(s.getSnapshot().ready).toBe(true);
  });

  it('sweeps a zero-byte leftover instead of calling it music', async () => {
    const fs = fakeFs({ sizes: { 7: 0, 9: 2048 } });
    const s = store(fs);
    await s.load();

    expect(s.isDownloaded('7')).toBe(false);
    expect(fs.files.has('7')).toBe(false);
    expect(s.getSnapshot().totalBytes).toBe(2048);
  });

  it('an empty phone is ready, not broken', async () => {
    const s = store(fakeFs());
    await s.load();
    expect(s.getSnapshot().ready).toBe(true);
    expect(s.getSnapshot().downloaded.size).toBe(0);
  });
});

describe('formatBytes', () => {
  it('reads the way a storage line should', () => {
    expect(formatBytes(0)).toBe('0 MB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(120 * 1024 * 1024)).toBe('120 MB');
    expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe('2.5 GB');
    expect(formatBytes(1024)).toBe('<0.1 MB');
  });
});
