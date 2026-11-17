/**
 * documentOpen — get a document's bytes onto the phone once, then either hand
 * them to an in-app viewer (PDFs, and Word documents since 2026-11-17) or to
 * the system share sheet (Quick Look / Open in …), which is still the right
 * answer for everything else and for the full fidelity of a .docx.
 *
 * `ensureLocalCopy` is the half both paths share: one cache directory, one
 * download, one set of error words. Cached files open instantly; a download
 * reports progress for the row's hairline bar. No native module beyond
 * expo-file-system/legacy (the app-wide import path) and expo-sharing.
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

const DIR = `${FileSystem.cacheDirectory || ''}files/`;
/**
 * The system's own name for a type, so iOS offers a PREVIEW rather than only
 * "copy to …". Word was missing from this map and fell through to
 * `public.data`, which tells the share sheet nothing about what it is
 * holding — so the one thing a Word file most needed from this path was the
 * one thing it did not get.
 */
const UTI = {
  'application/pdf': 'com.adobe.pdf',
  'text/plain': 'public.plain-text',
  'application/zip': 'public.zip-archive',
  'application/json': 'public.json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'org.openxmlformats.wordprocessingml.document',
  'application/msword': 'com.microsoft.word.doc',
  'application/rtf': 'public.rtf',
};

const safeName = (s) => String(s || 'file').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
export const cachePathFor = (item) => `${DIR}${item.id}-${safeName(item.originalName || item.filename)}`;

/**
 * The file on disk, downloading it first if this is the first time. Returns
 * { uri, cached } — `cached` says whether the bytes were already here, which
 * the viewer uses to decide whether a spinner is even worth showing.
 */
export async function ensureLocalCopy(item, { getFullUrl, onProgress } = {}) {
  const dest = cachePathFor(item);
  const info = await FileSystem.getInfoAsync(dest);
  const cached = !!(info && info.exists && (info.size == null || info.size > 0));
  if (cached) return { uri: dest, cached: true };

  await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
  const url = getFullUrl(item.rawUrl);
  const task = FileSystem.createDownloadResumable(url, dest, {}, (p) => {
    if (onProgress && p.totalBytesExpectedToWrite > 0) onProgress(Math.min(1, p.totalBytesWritten / p.totalBytesExpectedToWrite));
  });
  let res;
  try { res = await task.downloadAsync(); } catch { res = null; }
  if (!res || res.status < 200 || res.status >= 300) {
    // A half-written file would otherwise be "cached" forever and every later
    // open would render a truncated document instead of retrying the download.
    await FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => {});
    if (item.storageMode === 'tunnel' && (!res || res.status >= 500)) throw new Error('Not reachable right now — the computer holding it is offline.');
    throw new Error('Could not download the file.');
  }
  onProgress?.(1);
  return { uri: dest, cached: false };
}

/** Hand the file to the OS: Quick Look, or Open in another app. */
export async function shareDocument(item, { getFullUrl, onProgress } = {}) {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  const { uri, cached } = await ensureLocalCopy(item, { getFullUrl, onProgress });
  const mimeType = item.mimeType || 'application/octet-stream';
  await Sharing.shareAsync(uri, { mimeType, UTI: UTI[mimeType] || 'public.data', dialogTitle: item.originalName || item.filename || 'File' });
  return { uri, cached };
}

// The name FolderPage has always called. Kept as the alias rather than renamed
// at every call site, so "open this document" stays one word at the top level.
export const openDocument = shareDocument;
