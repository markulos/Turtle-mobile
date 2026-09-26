/**
 * What to CALL the things in an upload.
 *
 * Both upload surfaces had "photo" welded into them: the share toast counted a
 * batch of PDFs as "2/3 photos", and the upload sheet titled a pile of videos
 * "Upload 4 photos". Now that a folder can be filled from the phone's file
 * browser, that is not a wording nit — it is the app telling you it is doing
 * something other than what it is doing.
 *
 * Pure and shared, so the sheet and the toast cannot drift apart.
 */

const WORDS = {
  photo: ['photo', 'photos'],
  video: ['video', 'videos'],
  file: ['file', 'files'],
  item: ['item', 'items'],
};

export function pluralise(kind, n) {
  const [one, many] = WORDS[kind] || WORDS.item;
  return n === 1 ? one : many;
}

/** "1 photo", "4 videos", "12 files". */
export function countOf(kind, n) {
  return `${n} ${pluralise(kind, n)}`;
}

/**
 * The right word for a batch of picked assets.
 *
 * All photos → photo. All videos → video. Anything that is neither (a PDF, a
 * spreadsheet, an asset the picker typed as nothing at all) → file, which is
 * the generic that is never actually WRONG. A mix of photos and videos → item,
 * because calling a video a photo is the thing being fixed here.
 */
export function batchKind(assets) {
  const list = Array.isArray(assets) ? assets : [];
  if (list.length === 0) return 'item';

  let photos = 0;
  let videos = 0;
  let others = 0;
  for (const asset of list) {
    const type = String(asset?.type || asset?.mediaType || '').toLowerCase();
    const mime = String(asset?.mimeType || '').toLowerCase();
    if (type === 'video' || mime.startsWith('video/')) videos += 1;
    else if (type === 'image' || type === 'photo' || mime.startsWith('image/')) photos += 1;
    else others += 1;
  }

  if (others > 0) return 'file';
  if (videos === 0) return 'photo';
  if (photos === 0) return 'video';
  return 'item';
}

/** "3 photos" / "1 file" for a batch of assets. */
export function describeBatch(assets) {
  const list = Array.isArray(assets) ? assets : [];
  return countOf(batchKind(list), list.length);
}

/**
 * The right word for a ShareUpload JOB, which carries no asset list — only the
 * kind it was enqueued as. Documents filed into a folder and Music Vault
 * imports are both "files"; the plain share path is photos.
 */
export function jobKind(kind) {
  return kind === 'files' || kind === 'audio-files' || kind === 'audio-url' ? 'file' : 'photo';
}
