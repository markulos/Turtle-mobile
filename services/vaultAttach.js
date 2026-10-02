/**
 * Picking a photo on a phone and putting it in the vault.
 *
 * The flow is the same wherever it is used — a note's files, a message's photos:
 * the file goes through the ORDINARY media pipeline first and the thing that
 * wanted it keeps the id that comes back. So the upload happens IMMEDIATELY,
 * when the file is picked, not when the note is saved or the message is sent.
 * Holding bytes in memory until then means a cancel path that silently discards
 * them, and a composer that cannot finish offline without losing its files. The
 * consequence is honest and visible: a file picked here is in the vault from that
 * moment, whatever happens to the thing that picked it.
 *
 * What is NOT used here: the vault's own upload queue (VaultUploadContext). That
 * one is a background batch pipeline — checkpointed, resumable,
 * duplicate-fingerprinted — and fire-and-forget by design. A caller here needs
 * the media ID BACK to store on itself, which a fire-and-forget queue cannot
 * give it. So this goes straight at the shared streaming uploader underneath.
 *
 * Note-specific amounts and wording live in screens/NotesScreen/noteAttach, which
 * is this module's first caller; nothing here knows what a note is.
 */
import * as ImagePicker from 'expo-image-picker';
import { streamMultipartUpload } from './streamMultipartUpload';

/** A readable name for a picked asset, falling back to the URI's tail. */
export function assetFileName(asset, index = 0) {
  const given = typeof asset?.fileName === 'string' ? asset.fileName.trim() : '';
  if (given) return given;
  const tail = String(asset?.uri || '').split(/[?#]/, 1)[0].split('/').pop();
  return tail || `attachment-${index + 1}`;
}

/**
 * The name the VAULT will end up with if we say nothing.
 *
 * expo's uploader labels the multipart part with the file URI's BASENAME, and
 * that is what multer reports as `originalname` — so a photo lands as a picker
 * UUID and a picked document lands as the staging copy's timestamped name.
 * Neither is what the user chose, and the chip in a note shows exactly this.
 * Exported so a caller can compare and only pay for a rename when it differs.
 */
export function uploadedName(uri) {
  return String(uri || '').split(/[?#]/, 1)[0].split('/').pop() || '';
}

/**
 * Pull the new media row out of a successful upload.
 *
 * streamMultipartUpload has already thrown for any non-2xx, so the only failure
 * left to catch here is a 200 that says success:false.
 */
export function parseUploadResult(result) {
  let payload = null;
  try { payload = JSON.parse(result?.body || ''); } catch { payload = null; }
  if (payload?.success === false) {
    throw new Error(payload.error || payload.message || 'The vault would not take that file.');
  }
  const media = payload?.media;
  const id = media?.id;
  if (id === undefined || id === null || id === '') {
    throw new Error('The vault did not return an id for that file.');
  }
  return {
    id: String(id),
    name: media.originalName || media.filename || null,
    type: media.type || null,
    thumbnailUrl: media.thumbnailUrl || null,
    thumbnailLgUrl: media.thumbnailLgUrl || null,
  };
}

/**
 * Turn an uploader error into something worth showing.
 *
 * The raw messages are diagnostics ("HTTP 413: <300 chars of body>") — right for
 * the log, wrong under a filename in a composer.
 */
export function uploadErrorMessage(err) {
  const msg = String(err?.message || '');
  if (/Upload cancelled/i.test(msg)) return 'Cancelled.';
  if (/HTTP 413/.test(msg)) return 'Too large for this pond.';
  if (/HTTP 40[13]/.test(msg)) return 'The pond refused it — sign in again?';
  if (/HTTP 4\d\d/.test(msg)) return 'The pond would not take that file.';
  if (/HTTP 5\d\d/.test(msg)) return 'The pond could not store it.';
  if (/stalled/i.test(msg)) return 'Stalled — check the connection.';
  return msg.slice(0, 120) || 'Upload failed.';
}

/**
 * The photo library, for a surface that can only show pictures.
 *
 * Images only, on purpose. The vault takes video happily, but a caller that
 * renders a non-image as a named chip and only pages pictures in its viewer
 * would attach a video and then look like a dead end.
 *
 * `limit` is handed to the system picker rather than enforced afterwards, so the
 * user is told how many they may take BEFORE choosing rather than after.
 */
export async function pickPhotos({ limit = 1 } = {}) {
  const room = Math.max(1, limit);
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
    allowsMultipleSelection: room > 1,
    selectionLimit: room,
  });
  if (!res || res.canceled || !res.assets?.length) return { status: 'canceled', assets: [] };
  return {
    status: 'picked',
    assets: res.assets.slice(0, room).map((a, i) => ({
      uri: a.uri,
      fileName: assetFileName(a, i),
      mimeType: a.mimeType || 'image/jpeg',
    })),
  };
}

/**
 * Send one picked file to the vault and hand back the row it became.
 *
 * `tags` are stamped at upload so a file is never untagged in the vault even if
 * the thing that picked it is abandoned — the same reasoning the web composer's
 * first tag pass follows. `label` is for the uploader's own logging.
 */
export async function uploadPickedAsset({
  uploadUrl, token, asset, tags, label, onProgress, signal,
}) {
  const parameters = {};
  if (Array.isArray(tags) && tags.length > 0) parameters.tags = JSON.stringify(tags);
  const result = await streamMultipartUpload({
    url: uploadUrl,
    fileUri: asset.uri,
    mimeType: asset.mimeType || 'application/octet-stream',
    parameters,
    token,
    label: label || `attach:${asset.fileName}`,
    onProgress,
    signal,
    fieldName: 'media',
  });
  return parseUploadResult(result);
}
