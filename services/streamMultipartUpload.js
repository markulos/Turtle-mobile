import * as FileSystem from 'expo-file-system/legacy';

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
}) {
  const cancelledError = () => new Error('Upload cancelled');
  if (signal?.aborted) throw cancelledError();
  let lastErr = null;
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
        stallTimer = setInterval(() => {
          const idleMs = Date.now() - lastProgressAt;
          const threshold = allSentAt ? UPLOAD_PROCESSING_MS : UPLOAD_STALL_MS;
          if (idleMs > threshold) {
            const phase = allSentAt ? 'server processing' : 'transfer';
            console.warn(
              `[VaultUpload] ⏱ ${label} · watchdog tripped during ${phase} (idle ${Math.round(idleMs / 1000)}s)`
            );
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
      lastErr = new Error(`HTTP ${status}: ${String(result?.body || '').slice(0, 300)}`);
      console.warn(
        `[VaultUpload] ✗ ${label} · HTTP ${status} (attempt ${attempt}/${maxAttempts})`
      );
      if (status < 500 && status !== 408 && status !== 429) throw lastErr;
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
      if (/HTTP 4\d\d/.test(error.message) && !/HTTP (408|429)/.test(error.message)) break;
    } finally {
      if (abortHandler) signal?.removeEventListener('abort', abortHandler);
    }
    if (attempt < maxAttempts) {
      if (signal?.aborted) throw cancelledError();
      await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }
  throw lastErr || new Error('upload failed');
}
