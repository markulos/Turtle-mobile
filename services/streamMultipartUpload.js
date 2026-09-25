import * as FileSystem from 'expo-file-system/legacy';
import { decideRetry, transportRetryDelayMs } from './uploadRetryPolicy';
import { chooseUploadTransport, isMediaUploadUrl } from './uploadTransport';
import { chunkedUpload } from './chunkedUpload';

const UPLOAD_MAX_ATTEMPTS = 3;
const UPLOAD_STALL_MS = 60000;
const UPLOAD_PROCESSING_MS = 300000;

export async function streamMultipartUpload({
  url,
  fileUri,
  mimeType,
  parameters,
  token,
  label,
  onProgress,
  signal,
  // The vault's ingest reads a field called 'media'; the transcription route
  // reads one called 'file'. Defaulted so every existing caller is unchanged.
  fieldName = 'media',
  // Retries are safe when the destination dedupes (the vault) and unsafe when
  // it queues work (transcription: a lost response retried is a second GPU
  // job for the same audio). Callers that cannot tolerate a duplicate pass 1
  // and surface an explicit Retry instead.
  maxAttempts = UPLOAD_MAX_ATTEMPTS,
  // ({ phase, idleMs, attempt }) — called when the watchdog cancels a task,
  // so the caller can log it as a pipeline anomaly.
  onAnomaly,
  // The file's size when the caller already knows it; otherwise it is read
  // here. It decides the transport (services/uploadTransport): a body too big
  // to cross the edge in one request goes in parts instead of stalling.
  fileSize = null,
}) {
  const cancelledError = () => new Error('Upload cancelled');
  if (signal?.aborted) throw cancelledError();
  const transport = chooseUploadTransport({
    url,
    fieldName,
    sizeBytes: Number(fileSize) || (isMediaUploadUrl(url) && fieldName === 'media' ? await fileSizeOf(fileUri) : 0),
  });
  if (transport.mode === 'chunked') {
    console.log(
      `[VaultUpload] ⇶ ${label} · ${(transport.sizeBytes / (1024 * 1024)).toFixed(1)}MB · sent in parts (one body this size does not cross the edge)`
    );
    const finished = await chunkedUpload({
      baseUrl: transport.baseUrl,
      fileUri,
      fileSize: transport.sizeBytes,
      originalName: parameters?.originalName || label || 'file',
      mimeType,
      parameters,
      token,
      label,
      onProgress,
      signal,
      onAnomaly,
    });
    // The same shape the one-request path resolves with, so no caller has to
    // know which way the bytes went.
    return { status: 200, headers: {}, body: JSON.stringify(finished ?? {}) };
  }
  let lastErr = null;
  // Admission refusals ("the pond is busy") are waited out on their own clock
  // and never counted as transfer attempts — see services/uploadRetryPolicy.
  let busyWaits = 0;
  let busyWaitedMs = 0;
  let giveUp = false;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startedAt = Date.now();
    let lastProgressAt = Date.now();
    let allSentAt = null;
    let stallTimer = null;
    let abortHandler = null;
    try {
      const task = FileSystem.createUploadTask(
        url,
        fileUri,
        {
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          fieldName,
          mimeType,
          parameters,
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
        (progress) => {
          lastProgressAt = Date.now();
          const total = progress.totalBytesExpectedToSend || 0;
          const sent = progress.totalBytesSent || 0;
          if (total > 0 && onProgress) {
            onProgress(Math.min(99, Math.round((sent / total) * 100)));
          }
          if (total > 0 && sent >= total && allSentAt === null) {
            allSentAt = Date.now();
            const seconds = ((allSentAt - startedAt) / 1000).toFixed(1);
            console.log(
              `[VaultUpload] ⏳ ${label} · ${(total / (1024 * 1024)).toFixed(1)}MB sent in ${seconds}s · awaiting server processing…`
            );
          }
        }
      );

      const result = await new Promise((resolve, reject) => {
        let settled = false;
        const settle = (callback, value) => {
          if (settled) return;
          settled = true;
          callback(value);
        };
        abortHandler = () => {
          task.cancelAsync().catch(() => {});
          settle(reject, cancelledError());
        };
        signal?.addEventListener('abort', abortHandler, { once: true });
        if (signal?.aborted) {
          abortHandler();
          return;
        }
        let lastTickAt = Date.now();
        stallTimer = setInterval(() => {
          const now = Date.now();
          // A gap of several ticks means the app was SUSPENDED (timers don't
          // run while iOS holds the app; the background session kept going).
          // Not the transfer's fault — restart the idle clock instead of
          // cancelling a task that may have finished while we slept.
          if (now - lastTickAt > 15000) {
            lastTickAt = now;
            lastProgressAt = now;
            return;
          }
          lastTickAt = now;
          const idleMs = now - lastProgressAt;
          const threshold = allSentAt ? UPLOAD_PROCESSING_MS : UPLOAD_STALL_MS;
          if (idleMs > threshold) {
            const phase = allSentAt ? 'server processing' : 'transfer';
            console.warn(
              `[VaultUpload] ⏱ ${label} · watchdog tripped during ${phase} (idle ${Math.round(idleMs / 1000)}s)`
            );
            try { onAnomaly?.({ phase, idleMs: Math.round(idleMs), attempt }); } catch { /* never throw from a timer */ }
            task.cancelAsync().catch(() => {});
            settle(
              reject,
              new Error(
                `stalled during ${phase} — no progress for ${Math.round(threshold / 1000)}s`
              )
            );
          }
        }, 5000);
        task.uploadAsync().then(
          (value) => settle(resolve, value),
          (error) => settle(reject, error)
        );
      });
      if (stallTimer) {
        clearInterval(stallTimer);
        stallTimer = null;
      }

      const status = result?.status ?? 0;
      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      if (status >= 200 && status < 300) {
        if (onProgress) onProgress(100);
        console.log(`[VaultUpload] ✓ ${label} · ${seconds}s · HTTP ${status} (attempt ${attempt})`);
        return result;
      }
      const verdict = decideRetry({
        status,
        body: result?.body,
        headers: result?.headers,
        attempt,
        maxAttempts,
        busyWaits,
        busyWaitedMs,
      });
      if (verdict.busy) {
        // The pond refused to START this upload — nothing was transferred, so
        // this is not an attempt. Wait as long as it asked (plus a little), then
        // send the same attempt again, until the busy budget runs out.
        if (verdict.action !== 'retry') {
          lastErr = new Error(
            `Turtle is busy with other uploads — gave up after waiting ${Math.round(busyWaitedMs / 1000)}s (HTTP ${status})`
          );
          console.warn(`[VaultUpload] ✗ ${label} · ${lastErr.message}`);
          giveUp = true;
          throw lastErr;
        }
        console.warn(
          `[VaultUpload] ⏸ ${label} · pond busy (HTTP ${status}) · waiting ${(verdict.delayMs / 1000).toFixed(1)}s (attempt ${attempt} stands)`
        );
        busyWaits += 1;
        busyWaitedMs += verdict.delayMs;
        await new Promise((resolve) => setTimeout(resolve, verdict.delayMs));
        if (signal?.aborted) throw cancelledError();
        attempt -= 1; // the for-increment restores it: same attempt, again
        continue;
      }
      lastErr = new Error(`HTTP ${status}: ${String(result?.body || '').slice(0, 300)}`);
      console.warn(
        `[VaultUpload] ✗ ${label} · HTTP ${status} (attempt ${attempt}/${maxAttempts})`
      );
      if (verdict.action !== 'retry') {
        giveUp = true;
        throw lastErr;
      }
    } catch (error) {
      if (stallTimer) {
        clearInterval(stallTimer);
        stallTimer = null;
      }
      lastErr = error;
      if (signal?.aborted || error?.message === 'Upload cancelled') {
        throw cancelledError();
      }
      console.warn(
        `[VaultUpload] ✗ ${label} (attempt ${attempt}/${maxAttempts}): ${error.message}`
      );
      if (giveUp) break;
      if (/HTTP 4\d\d/.test(error.message) && !/HTTP (408|429)/.test(error.message)) break;
    } finally {
      if (abortHandler) signal?.removeEventListener('abort', abortHandler);
    }
    if (attempt < maxAttempts) {
      if (signal?.aborted) throw cancelledError();
      await new Promise((resolve) => setTimeout(resolve, transportRetryDelayMs(attempt)));
    }
  }
  throw lastErr || new Error('upload failed');
}

/** Bytes on disk, or 0 when the platform cannot say (→ the one-request path). */
async function fileSizeOf(fileUri) {
  if (typeof FileSystem.getInfoAsync !== 'function') return 0;
  try {
    const info = await FileSystem.getInfoAsync(fileUri, { size: true });
    return info?.exists ? Number(info.size) || 0 : 0;
  } catch {
    return 0;
  }
}
