/**
 * "Now that it is safely in the vault, can we delete it off the phone?"
 *
 * The photo path has offered this since the beginning; the Files path never
 * did, and the reason turns out to matter: WHAT the OS handed us differs by
 * source, and only some of those things are ours to delete.
 *
 * ─── The three cases ────────────────────────────────────────────────────────
 *
 *   ASSET — picked from the camera roll. We hold a MediaLibrary `assetId`,
 *     which is a durable handle on the user's own photo. `deleteAssetsAsync`
 *     shows the OS's own confirmation and removes it. This is the one that
 *     already worked.
 *
 *   SAF — an Android document picked through the Storage Access Framework. A
 *     `content://` URI the picker granted us access to, deletable through
 *     `StorageAccessFramework.deleteAsync`.
 *
 *   STAGED — our OWN copy. The document picker does not hand over the user's
 *     file; it hands over a COPY in the app sandbox (see systemFilePick), and
 *     that copy is then staged into documentDirectory so an interrupted batch
 *     can resume. That copy is real space on the device and is ours to
 *     reclaim, but deleting it does NOT remove the user's file and must never
 *     be offered as though it did.
 *
 * ─── Why iOS documents can't be offered ─────────────────────────────────────
 *
 * On iOS the document picker gives a copy, full stop. The original lives in
 * the Files provider (iCloud, On My iPhone, Dropbox) and no public API lets an
 * app delete it. So for an iOS document there is nothing to offer, and the
 * honest UI is no button rather than one that quietly deletes our own cache
 * and leaves the user's file where it was.
 *
 * All of which is why this is a classifier and not an `if (assetId)`: the
 * question "may we?" has four different answers and the UI has to show a
 * count that is exactly the number of things that will actually disappear.
 */

/** A handle on the user's own photo/video. */
export const DELETE_ASSET = 'asset';
/** An Android SAF document we were granted access to. */
export const DELETE_SAF = 'saf';
/** Our own staging copy — reclaimable, but NOT the user's file. */
export const DELETE_STAGED = 'staged';

/**
 * Items are only ever offered once they are SAFE — uploaded, or skipped
 * because the vault already had them. Anything else is still the only copy.
 */
const isSafe = (item) => item?.status === 'uploaded' || item?.status === 'duplicate';

/**
 * What, if anything, we may delete for this item. `platform` is
 * `Platform.OS`; passed in rather than imported so the rule can be checked
 * for both phones from one test run.
 */
export function deletableKind(item, { platform = 'ios' } = {}) {
  if (!isSafe(item)) return null;
  if (item.assetId) return DELETE_ASSET;
  // SAF is Android-only by construction: a content:// URI on any other
  // platform is something we do not understand and will not delete.
  if (platform === 'android' && typeof item.sourceUri === 'string' && item.sourceUri.startsWith('content://')) {
    return DELETE_SAF;
  }
  if (item.stagedPath) return DELETE_STAGED;
  return null;
}

/**
 * The work list for a batch: what to hand each delete API, and the count to
 * put on the button.
 *
 * `count` deliberately excludes staged copies. It is the number of the USER's
 * files that will disappear, and it is what the button says — a count that
 * included our own cache would be a lie in the one place it must not be.
 */
export function deletionPlan(items, { platform = 'ios' } = {}) {
  const assetIds = [];
  const safUris = [];
  const stagedPaths = [];
  for (const item of items || []) {
    switch (deletableKind(item, { platform })) {
      case DELETE_ASSET: assetIds.push(item.assetId); break;
      case DELETE_SAF: safUris.push(item.sourceUri); break;
      case DELETE_STAGED: stagedPaths.push(item.stagedPath); break;
      default: break;
    }
  }
  return { assetIds, safUris, stagedPaths, count: assetIds.length + safUris.length };
}

/**
 * Is this item's own staging copy ours to throw away yet?
 *
 * Separate from the offer on purpose: no permission is involved and no file of
 * the user's disappears, so there is nothing to ask about. The queue calls it
 * as each item settles (see reclaimStaged in VaultUploadContext), which is
 * what keeps a 400 MB PDF from sitting in documentDirectory for a week after
 * it landed. A staged file whose upload is still pending is the thing a resume
 * depends on, hence the safety check.
 */
export function isReclaimable(item) {
  return !!(item?.stagedPath && isSafe(item));
}
