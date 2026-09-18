/**
 * documentOpen — open a document the way iOS wants: the bytes land in the
 * app's cache once, then the system share sheet shows them (Quick Look /
 * Open in …). Cached files open instantly; a download reports progress for
 * the row's hairline bar. No native module beyond expo-file-system/legacy
 * (the app-wide import path) and expo-sharing.
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

const DIR = `${FileSystem.cacheDirectory || ''}files/`;
const UTI = { 'application/pdf': 'com.adobe.pdf', 'text/plain': 'public.plain-text', 'application/zip': 'public.zip-archive', 'application/json': 'public.json' };

const safeName = (s) => String(s || 'file').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
export const cachePathFor = (item) => `${DIR}${item.id}-${safeName(item.originalName || item.filename)}`;

export async function openDocument(item, { getFullUrl, onProgress } = {}) {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  const dest = cachePathFor(item);
  const info = await FileSystem.getInfoAsync(dest);
  let cached = !!(info && info.exists && (info.size == null || info.size > 0));
  if (!cached) {
    await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
    const url = getFullUrl(item.rawUrl);
    const task = FileSystem.createDownloadResumable(url, dest, {}, (p) => {
      if (onProgress && p.totalBytesExpectedToWrite > 0) onProgress(Math.min(1, p.totalBytesWritten / p.totalBytesExpectedToWrite));
    });
    let res;
    try { res = await task.downloadAsync(); } catch { res = null; }
    if (!res || res.status < 200 || res.status >= 300) {
      await FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => {});
      if (item.storageMode === 'tunnel' && (!res || res.status >= 500)) throw new Error('Not reachable right now — the computer holding it is offline.');
      throw new Error('Could not download the file.');
    }
    onProgress?.(1);
  }
  const mimeType = item.mimeType || 'application/octet-stream';
  await Sharing.shareAsync(dest, { mimeType, UTI: UTI[mimeType] || 'public.data', dialogTitle: item.originalName || item.filename || 'File' });
  return { uri: dest, cached };
}
