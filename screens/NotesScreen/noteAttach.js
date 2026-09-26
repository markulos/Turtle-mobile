/**
 * Adding files to a note, from the phone.
 *
 * The web composer gets this for free from the desktop: Ctrl+V and a drag from
 * Explorer. A phone has neither, so the note needs real buttons and the two
 * sources a phone actually has — the photo library and the OS file browser.
 *
 * The shape of the flow is taken from the web composer deliberately, because
 * the awkward part is the same on both: a file is uploaded to the MEDIA VAULT
 * (POST /media/upload, the same endpoint the photo grid uses) and the note
 * remembers its id. So the upload happens IMMEDIATELY, when the file is picked,
 * not when the note is saved. Holding bytes in memory until Done would mean a
 * cancel path that silently discards them, and a note that can't be saved
 * offline without losing its files. The consequence is honest and visible:
 * a file added to a note is in the vault from that moment, whatever happens to
 * the note afterwards.
 *
 * What is NOT reused here: the vault's own upload queue (VaultUploadContext).
 * That one is a background batch pipeline — checkpointed, resumable,
 * duplicate-fingerprinted — and it is fire-and-forget by design. A note needs
 * the media ID BACK to store on itself, which a fire-and-forget queue cannot
 * give it. So this goes straight at the shared streaming uploader underneath.
 */
import * as ImagePicker from 'expo-image-picker';
import { streamMultipartUpload } from '../../services/streamMultipartUpload';
// The OS file browser, its lazy native-module guard, and the "copy somewhere
// iOS won't reclaim" staging — all already solved for the Files vault. The
// entries it hands back are {path, fileName, mimeType}, which is the shape the
// uploader below wants anyway.
import { pickSystemFiles } from '../TurtleScreen/components/FilesVault/systemFilePick';

export { pickSystemFiles };

/**
 * How many files one note may carry. Mirrors the server's own MAX_MEDIA_IDS —
 * normalizeMediaIds truncates silently past it, and a client that let you add
 * the 201st file would show it attached and then lose it on the next read.
 */
export const MAX_NOTE_MEDIA = 200;

/** Room left for more, given what the note already holds (and has in flight). */
export function attachRoom(used) {
  return Math.max(0, MAX_NOTE_MEDIA - (used || 0));
}

/**
 * Fold newly-uploaded ids into the note's list: append, dedupe, cap.
 *
 * Order is "the order they were added", which is the order the strip and the
 * viewer show them in. `dropped` is how many fell off the end of the cap, so
 * the caller can say so rather than quietly losing them.
 */
export function mergeMediaIds(existing, added) {
  const out = [];
  const seen = new Set();
  for (const raw of [...(existing || []), ...(added || [])]) {
    const id = raw ? String(raw) : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return { ids: out.slice(0, MAX_NOTE_MEDIA), dropped: Math.max(0, out.length - MAX_NOTE_MEDIA) };
}

/** Drop one attachment from a note's list. */
export function removeMediaId(existing, id) {
  const target = String(id);
  return (existing || []).map(String).filter((x) => x !== target);
}

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
 * Neither is what the user chose, and the chip in the note shows exactly this.
 * Exported so the caller can compare and only pay for a rename when it differs.
 */
export function uploadedName(uri) {
  return String(uri || '').split(/[?#]/, 1)[0].split('/').pop() || '';
}

/**
 * Pull the new media row out of a successful upload.
 *
 * streamMultipartUpload has already thrown for any non-2xx, so the only
 * failure left to catch here is a 200 that says success:false.
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
 * The raw messages are diagnostics ("HTTP 413: <300 chars of body>") — right
 * for the log, wrong under a filename in a note.
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
 * The photo library.
 *
 * Images only, on purpose. The vault takes video happily, but a note renders a
 * non-image attachment as a named chip and the in-note viewer only pages
 * pictures — so a video picked here would attach and then look like a dead
 * end. The Files button is the door for everything else, where a chip is the
 * honest representation anyway.
 */
export async function pickNotePhotos({ room = MAX_NOTE_MEDIA } = {}) {
  const limit = Math.max(1, room);
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
    // The system picker enforces the remaining room itself, so the user is
    // told before choosing rather than after.
    allowsMultipleSelection: limit > 1,
    selectionLimit: limit,
  });
  if (!res || res.canceled || !res.assets?.length) return { status: 'canceled', assets: [] };
  return {
    status: 'picked',
    assets: res.assets.slice(0, limit).map((a, i) => ({
      uri: a.uri,
      fileName: assetFileName(a, i),
      mimeType: a.mimeType || 'image/jpeg',
    })),
  };
}

/**
 * Send one file to the vault and hand back the row it became.
 *
 * Tags are stamped at upload so a file is never untagged in the vault even if
 * the note is abandoned — same reasoning as the web composer's first tag pass.
 */
export async function uploadNoteAttachment({ uploadUrl, token, asset, tags, onProgress, signal }) {
  const parameters = {};
  if (Array.isArray(tags) && tags.length > 0) parameters.tags = JSON.stringify(tags);
  const result = await streamMultipartUpload({
    url: uploadUrl,
    fileUri: asset.uri,
    mimeType: asset.mimeType || 'application/octet-stream',
    parameters,
    token,
    label: `note:${asset.fileName}`,
    onProgress,
    signal,
    fieldName: 'media',
  });
  return parseUploadResult(result);
}
