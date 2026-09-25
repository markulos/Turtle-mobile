/**
 * chunkedUpload — send one file as a series of small requests, so a dropped
 * connection costs a chunk instead of the whole file.
 *
 * WHY, specifically: an 86 MB PDF from a phone on 5G never reached the pond.
 * The watchdog in streamMultipartUpload recorded bytes flowing for a moment,
 * then nothing for 60 s, on all three attempts — and the server log has no
 * matching "POST /api/media/upload received", while small requests from the
 * same phone in the same second were fine. Something in the path (the app
 * reaches the pond through cloudflared) will not carry a body that size. No
 * client retry helps, because every attempt hits the same wall at the same
 * place; the only way through is to stop sending one big body.
 *
 * The protocol is the server's (routes/media.js, createChunkedUploadHandlers),
 * which is in turn the one album share links have used for the same reason:
 *   POST /media/upload/part    multipart { uploadId, index, chunk }
 *   POST /media/upload/finish  json { uploadId, originalName, mimeType, … }
 * Parts go strictly in order. An out-of-order part is answered 409 with
 * `expected`, which is the entire resume mechanism: whatever the client thinks
 * it sent, the server says where to carry on from, and we seek there rather
 * than starting again.
 *
 * Progress is REAL here in a way the whole-file path never managed: a part is
 * only counted once the server has acknowledged it, so the percentage tracks
 * bytes that actually landed rather than bytes handed to the OS.
 *
 * ── Why a part is STAGED AS A FILE and not posted as a Blob ────────────────
 * React Native's fetch cannot carry bytes inside a multipart form. Two walls,
 * both in the framework:
 *   1. `new Blob([uint8array])` THROWS — BlobManager.createFromParts refuses
 *      ArrayBuffer and ArrayBufferView outright ("not supported").
 *   2. Even given a Blob, FormData.getParts() spreads it into the part object,
 *      which yields `{_data}`; the native side only recognises a part carrying
 *      `string`, `uri` or `blob`, so it is dropped on the floor.
 * The one shape RN and Expo both carry reliably is a file URI — which is what
 * every working upload in this app already uses. So each slice is written to
 * its own small cache file and handed to the SAME native multipart uploader
 * the whole-file path uses, then deleted. That costs one 4 MB write per part
 * and buys a transport that is known to work on a real phone rather than only
 * in a test with `Blob` mocked.
 */
import * as FileSystem from 'expo-file-system/legacy';

/** Small enough to cross a hostile path, big enough not to be all overhead. */
export const CHUNK_BYTES = 4 * 1024 * 1024;
/**
 * Above this, a file goes up in chunks instead of one request.
 *
 * Set from what has actually been observed rather than from a round number:
 * every photo-sized upload in the logs succeeds in 1–6 s on the one-request
 * path, and the bodies that vanish before reaching the server have all been
 * far larger. 8 MB sits above ordinary photos (so the common case keeps the
 * cheaper single round trip) and below anything that has been failing.
 *
 * Lives here, not in a caller, because every door into the vault — the upload
 * queue and the share/"add from storage" path both — has to draw the line in
 * the same place, or a big file is chunked or not depending on which screen it
 * was picked from.
 */
export const CHUNKED_UPLOAD_THRESHOLD_BYTES = 8 * 1024 * 1024;
/** Attempts per PART. A part is cheap to resend; the file is not. */
const PART_MAX_ATTEMPTS = 4;
/**
 * A part with no movement at all for this long is abandoned and re-sent.
 *
 * IDLE, not elapsed: a deadline on the whole part punishes a slow link (4 MB
 * over a weak signal can honestly take minutes) while letting a truly dead
 * socket sit for just as long. What distinguishes the two is whether bytes are
 * still moving, which the upload task reports.
 */
const PART_STALL_MS = 60_000;
/** How often the stall watchdog looks. */
const WATCH_TICK_MS = 5_000;

const hex = (n) => {
  let out = '';
  for (let i = 0; i < n; i++) out += Math.floor(Math.random() * 16).toString(16);
  return out;
};

/** The server requires exactly 32 hex characters — it becomes a filename. */
export const newUploadId = () => hex(32);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Read one slice of a file as base64. expo-file-system's `position`/`length`
 * options are what make this a SLICE rather than "read 86 MB and cut it up" —
 * only the chunk is ever in memory.
 */
async function readSlice(fileUri, position, length) {
  return FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
    position,
    length,
  });
}

/**
 * Write one slice out as its own file, so the native uploader has a URI to
 * send. Named per (upload, index): a retry of the same part overwrites its own
 * scratch file instead of accumulating one per attempt.
 */
async function stagePart(uploadId, index, base64) {
  const uri = `${FileSystem.cacheDirectory}upload-part-${uploadId}-${index}`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  return uri;
}

/**
 * Run a native upload task under a stall watchdog and the caller's abort
 * signal. `uploadAsync` has neither, and a part that hangs forever is the exact
 * failure this module exists to survive.
 *
 * `activity.at` is when this part last moved bytes — written by the progress
 * callback and by the suspension branch below, read by the watchdog.
 */
function runPartTask(task, signal, activity) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let lastTickAt = Date.now();
    const stop = () => { task.cancelAsync().catch(() => {}); };
    const settle = (finish, value) => {
      if (settled) return;
      settled = true;
      clearInterval(watch);
      signal?.removeEventListener('abort', onAbort);
      finish(value);
    };
    const onAbort = () => { stop(); settle(reject, new Error('Upload cancelled')); };
    const watch = setInterval(() => {
      const now = Date.now();
      // A gap of several ticks means iOS SUSPENDED us; the background session
      // kept uploading while our timers did not run. Restart the idle clock
      // rather than cancel a part that may well have finished while we slept.
      if (now - lastTickAt > 3 * WATCH_TICK_MS) {
        lastTickAt = now;
        activity.at = now;
        return;
      }
      lastTickAt = now;
      const idleMs = now - activity.at;
      if (idleMs < PART_STALL_MS) return;
      stop();
      settle(reject, new Error(`part stalled — no progress for ${Math.round(idleMs / 1000)}s`));
    }, WATCH_TICK_MS);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) { onAbort(); return; }
    task.uploadAsync().then((value) => settle(resolve, value), (error) => settle(reject, error));
  });
}

/**
 * Upload `fileUri` in chunks.
 *
 * @returns the parsed /finish body on success.
 * @throws  on a refusal that retrying cannot fix (too large, no session, auth).
 */
export async function chunkedUpload({
  baseUrl,
  fileUri,
  fileSize,
  originalName,
  mimeType,
  parameters = {},
  token,
  label,
  onProgress,
  signal,
  chunkBytes = CHUNK_BYTES,
  onAnomaly,
}) {
  const cancelled = () => new Error('Upload cancelled');
  if (signal?.aborted) throw cancelled();

  const root = String(baseUrl).endsWith('/api') ? baseUrl : `${baseUrl}/api`;
  const partUrl = `${root}/media/upload/part`;
  const finishUrl = `${root}/media/upload/finish`;
  const uploadId = newUploadId();
  const total = Number(fileSize) || 0;
  const auth = token ? { Authorization: `Bearer ${token}` } : {};

  let index = 0;
  let sent = 0;
  // Highest percentage already reported. A part's own byte progress is allowed
  // to move the bar between acknowledgements — on a 300 MB file the gap
  // between two banked parts is otherwise long enough for the vault queue's
  // stall watchdog (60 s without progress) to retire a perfectly healthy
  // upload — but it may never move it BACKWARDS, which a resync would.
  let reportedPct = 0;
  const report = (pct) => {
    if (!onProgress || !(total > 0) || pct <= reportedPct) return;
    reportedPct = pct;
    onProgress(pct);
  };

  while (sent < total) {
    if (signal?.aborted) throw cancelled();
    const length = Math.min(chunkBytes, total - sent);

    let attempt = 0;
    for (;;) {
      attempt += 1;
      let outcome;
      try {
        outcome = await sendPart({
          partUrl, uploadId, index, fileUri, position: sent, length, auth, signal,
          onPartProgress: (bytes) => report(Math.min(99, Math.floor(((sent + bytes) / total) * 100))),
        });
      } catch (error) {
        if (signal?.aborted) throw cancelled();
        if (attempt >= PART_MAX_ATTEMPTS) {
          try { onAnomaly?.({ phase: 'chunk', attempt, index, sentBytes: sent, totalBytes: total }); } catch { /* never throw from reporting */ }
          throw new Error(`chunk ${index} failed after ${attempt} attempts: ${error.message}`);
        }
        // A part is cheap to resend, so a transport blip costs a second, not
        // the file. Backoff is per PART, not per file.
        await sleep(Math.min(8000, attempt * 1000));
        continue;
      }

      if (outcome.ok) {
        sent += length;
        index += 1;
        // Only count what the SERVER has acknowledged — this is what makes the
        // percentage mean "landed" rather than "handed to the OS".
        report(Math.min(99, Math.round((sent / total) * 100)));
        break;
      }

      // The resume case. Whatever we thought we had sent, the server says
      // where to carry on from — so seek there instead of starting over.
      if (outcome.expected != null && Number.isInteger(outcome.expected)) {
        const rewound = outcome.expected * chunkBytes;
        if (rewound > total) throw new Error('Upload session is out of step with the file');
        try { onAnomaly?.({ phase: 'chunk-resync', index, expected: outcome.expected, sentBytes: sent, totalBytes: total }); } catch { /* ignore */ }
        index = outcome.expected;
        sent = rewound;
        break;
      }

      if (outcome.retryable && attempt < PART_MAX_ATTEMPTS) {
        await sleep(Math.min(10_000, attempt * 2000));
        continue;
      }
      throw new Error(outcome.error || `chunk ${index} rejected (HTTP ${outcome.status})`);
    }
  }

  if (signal?.aborted) throw cancelled();
  const res = await fetch(finishUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth },
    body: JSON.stringify({ ...parameters, uploadId, originalName, mimeType }),
    signal,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.success === false) {
    throw new Error(body?.error || body?.message || `HTTP ${res.status}: finish rejected`);
  }
  if (onProgress) onProgress(100);
  console.log(`[VaultUpload] ✓ ${label} · chunked · ${index} parts · ${(total / (1024 * 1024)).toFixed(1)}MB`);
  return body;
}

/** One part. Resolves with a verdict; rejects only on transport failure. */
async function sendPart({ partUrl, uploadId, index, fileUri, position, length, auth, signal, onPartProgress }) {
  const partUri = await stagePart(uploadId, index, await readSlice(fileUri, position, length));
  const activity = { at: Date.now() };
  try {
    const task = FileSystem.createUploadTask(
      partUrl,
      partUri,
      {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        fieldName: 'chunk',
        mimeType: 'application/octet-stream',
        // Multer buffers the text fields before the handler runs, so these are
        // readable as req.body regardless of where the framing puts them.
        parameters: { uploadId, index: String(index) },
        headers: auth,
      },
      // Bytes handed to the OS: what keeps the stall watchdog quiet and the bar
      // moving inside a part. What a part is WORTH is still only banked once
      // the server has acknowledged it.
      (p) => {
        activity.at = Date.now();
        if (!onPartProgress) return;
        onPartProgress(Math.min(length, p?.totalBytesSent || 0));
      },
    );
    const result = await runPartTask(task, signal, activity);
    const status = result?.status ?? 0;
    let body = {};
    try { body = JSON.parse(result?.body || '{}'); } catch { /* not JSON: the verdict below is the status */ }
    if (status >= 200 && status < 300 && body?.success) return { ok: true };
    return {
      ok: false,
      status,
      error: body?.error,
      expected: body?.expected,
      // 503 BUSY and 5xx are worth another go; 4xx is a decision. A status of 0
      // is the native layer failing to answer at all — a transport blip.
      retryable: body?.retryable === true || status >= 500 || status === 0,
    };
  } finally {
    // The slice is spent either way, and 4 MB per abandoned part adds up on a
    // phone that is already short of space.
    FileSystem.deleteAsync(partUri, { idempotent: true }).catch(() => {});
  }
}
