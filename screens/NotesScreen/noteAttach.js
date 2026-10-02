/**
 * Adding files to a note, from the phone.
 *
 * The web composer gets this for free from the desktop: Ctrl+V and a drag from
 * Explorer. A phone has neither, so the note needs real buttons and the two
 * sources a phone actually has — the photo library and the OS file browser.
 *
 * Picking and uploading are not note-specific and live in services/vaultAttach
 * (the friends thread wants the same two steps for a message's photos). What is
 * note-specific is HOW MANY, and the id-list arithmetic underneath the strip —
 * that is what stayed here.
 */
import { pickPhotos, uploadPickedAsset } from '../../services/vaultAttach';
// The OS file browser, its lazy native-module guard, and the "copy somewhere iOS
// won't reclaim" staging — all already solved for the Files vault. The entries it
// hands back are {path, fileName, mimeType}, which is the shape the uploader
// wants anyway.
import { pickSystemFiles } from '../TurtleScreen/components/FilesVault/systemFilePick';

export { pickSystemFiles };

/**
 * How many files one note may carry. Mirrors the server's own MAX_MEDIA_IDS —
 * normalizeMediaIds truncates silently past it, and a client that let you add the
 * 201st file would show it attached and then lose it on the next read.
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
 * viewer show them in. `dropped` is how many fell off the end of the cap, so the
 * caller can say so rather than quietly losing them.
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

/**
 * The photo library, bounded by what this note can still take.
 *
 * Images only — see pickPhotos. The Files button is the door for everything
 * else, where a named chip is the honest representation anyway.
 */
export async function pickNotePhotos({ room = MAX_NOTE_MEDIA } = {}) {
  return pickPhotos({ limit: room });
}

/**
 * Send one file to the vault and hand back the row it became, tagged with the
 * note's tags so it is never untagged even if the note is abandoned.
 */
export async function uploadNoteAttachment({ uploadUrl, token, asset, tags, onProgress, signal }) {
  return uploadPickedAsset({
    uploadUrl, token, asset, tags, onProgress, signal, label: `note:${asset.fileName}`,
  });
}
