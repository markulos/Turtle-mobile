/**
 * "Pick from system storage" — the second source for adding to a folder.
 *
 * The ⋯ menu's other row opens the PHOTO library, which cannot see a PDF, a
 * spreadsheet, or anything sitting in Downloads: the exact things a Files
 * folder exists for. This opens the OS document browser instead (iOS Files,
 * Android's storage picker) and hands back entries in the same
 * {path, fileName, mimeType} shape enqueueFileShare already stages and
 * streams, so nothing downstream has to learn a second asset format.
 *
 * expo-document-picker is loaded LAZILY and defensively, for the same reason
 * MediaGallery loads react-native-share that way: its native module only
 * exists in a build that bundled it, so a top-level import would take down the
 * whole runtime on an older binary that picked this JS up as an OTA update.
 * Absent → status 'unavailable', which the call site turns into "this arrives
 * with the next build" rather than a white screen.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { classifySharedFile, supportedFolderFiles } from '../../../../utils/shareMediaClassifier';

/**
 * Where picked files are kept while they wait to upload.
 *
 * The OS picker copies into the CACHE directory, and the vault queue outlives
 * the pick: it checkpoints to storage and resumes a half-finished batch after
 * the app is killed. Cache is exactly the thing iOS reclaims under pressure,
 * so a 400 MB upload interrupted overnight would come back to a queue pointing
 * at files that no longer exist — every remaining item "missing". documentDirectory
 * is not reclaimed, so the batch survives to be resumed.
 */
const STAGE_DIR = `${FileSystem.documentDirectory || ''}picked-files/`;
/** Staged files older than this are nobody's batch any more. */
const STAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

let _checked = false;
let _picker = null;

const getPicker = () => {
  if (_checked) return _picker;
  _checked = true;
  try {
    // NOTE: installing the npm package is NOT enough — the app must be
    // natively rebuilt (EAS build / expo prebuild) for this require to resolve
    // a working native module.
    _picker = require('expo-document-picker');
  } catch {
    _picker = null;
  }
  return _picker;
};

/** Tests mount this module more than once with different module state. */
export function __resetSystemFilePickerForTests() {
  _checked = false;
  _picker = null;
}

const nameOf = (asset, index) => {
  const given = typeof asset?.name === 'string' ? asset.name.trim() : '';
  if (given) return given;
  const tail = String(asset?.uri || '').split(/[?#]/, 1)[0].split('/').pop();
  return tail || `file-${index + 1}`;
};

/**
 * Open the OS file browser.
 *
 * Returns { status, files, skipped } where status is one of:
 *   'picked'      — `files` is non-empty and ready for enqueueFileShare
 *   'canceled'    — the user backed out; say nothing
 *   'unavailable' — this binary has no document picker in it
 *   'empty'       — something was chosen but none of it can be filed here
 * `skipped` names whatever was dropped (audio, or a type the vault won't take),
 * so the caller can say which files did not come along instead of losing them
 * silently.
 */
export async function pickSystemFiles() {
  const picker = getPicker();
  if (!picker || typeof picker.getDocumentAsync !== 'function') {
    return { status: 'unavailable', files: [], skipped: [] };
  }

  const result = await picker.getDocumentAsync({
    multiple: true,
    // Everything. The classifier below decides what the vault will actually
    // take, so the OS browser never greys out a file we would have accepted.
    type: '*/*',
    // Copy into app cache first. Without it iOS hands back a security-scoped
    // URL that dies with the picker, and the staging copy inside
    // enqueueFileShare — which runs a tick later — would read a file that is
    // already gone.
    copyToCacheDirectory: true,
    // NOT the library default, which is `true`: that reads every picked file
    // into memory as a base64 STRING before the picker even resolves. The
    // uploader streams from disk by path and never looks at asset.base64, so
    // leaving it on would buy nothing and blow the heap on the first big video.
    base64: false,
  });

  if (!result || result.canceled) return { status: 'canceled', files: [], skipped: [] };

  const assets = Array.isArray(result.assets) ? result.assets : [];
  const entries = assets
    .filter((a) => a && typeof a.uri === 'string' && a.uri.trim())
    .map((a, i) => ({
      path: a.uri,
      // What the OS actually handed over, kept BEFORE staging copies it.
      //
      // On Android this is the SAF `content://` URI, which the upload queue
      // can later offer to delete (utils/originalDeletion). On iOS it is
      // already a copy in our own sandbox — the picker never gives out the
      // user's file — so the classifier reads it as undeletable and no offer
      // is made. Recorded either way: which of those two it is, is not this
      // function's business to decide.
      sourceUri: a.uri,
      fileName: nameOf(a, i),
      // Left as '' rather than omitted when the OS gives us nothing: the
      // classifier reads an empty mimeType as "missing" and falls through to
      // the extension, which is the whole reason a .pdf with no MIME still
      // files correctly.
      mimeType: typeof a.mimeType === 'string' ? a.mimeType : '',
    }));

  const files = supportedFolderFiles(entries);
  const kept = new Set(files.map((f) => f.path));
  const skipped = entries.filter((e) => !kept.has(e.path)).map((e) => ({
    fileName: e.fileName,
    // 'audio' reads differently to 'unsupported' in the message the caller
    // writes: one has somewhere else to go, the other does not.
    kind: classifySharedFile(e),
  }));

  if (files.length === 0) return { status: 'empty', files: [], skipped };
  const staged = await stagePickedFiles(files);
  return { status: 'picked', files: staged, skipped };
}

/**
 * Copy picked files somewhere the OS will not reclaim, and hand back the same
 * entries pointing at the copies. A copy that fails keeps its original path —
 * it may well outlive the session, and a file that might upload beats one that
 * definitely will not.
 */
export async function stagePickedFiles(files) {
  const list = Array.isArray(files) ? files : [];
  if (list.length === 0) return [];
  try {
    await FileSystem.makeDirectoryAsync(STAGE_DIR, { intermediates: true });
  } catch {
    return list;
  }
  sweepStagedFiles();

  const out = [];
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    // Prefixed with the clock so the sweep below can age them, and suffixed
    // with the real name so the upload still carries something readable.
    const dest = `${STAGE_DIR}${Date.now()}-${i}-${safeName(entry.fileName)}`;
    try {
      await FileSystem.copyAsync({ from: entry.path, to: dest });
      // `stagedPath` names the copy as OURS. The upload queue reclaims it the
      // moment the item is safe in the vault, rather than leaving it for the
      // TTL sweep a week later — a staged 400 MB video is real space on the
      // phone, and documentDirectory is the one place iOS will not reclaim it
      // for us.
      out.push({ ...entry, path: dest, staged: true, stagedPath: dest });
    } catch {
      out.push({ ...entry, staged: false });
    }
  }
  return out;
}

const safeName = (s) => String(s || 'file').replace(/[\\/:*?"<>|]/g, '_').slice(0, 100);

/**
 * Drop staged files older than the TTL. Nothing deletes them on success — the
 * uploader does not own them — so this is what stops the directory growing for
 * the life of the install. Fire-and-forget: a failed sweep is not worth
 * failing a pick over.
 */
export function sweepStagedFiles() {
  (async () => {
    try {
      const names = await FileSystem.readDirectoryAsync(STAGE_DIR);
      const cutoff = Date.now() - STAGE_TTL_MS;
      for (const name of names) {
        const stamp = Number(String(name).split('-', 1)[0]);
        if (Number.isFinite(stamp) && stamp < cutoff) {
          await FileSystem.deleteAsync(`${STAGE_DIR}${name}`, { idempotent: true }).catch(() => {});
        }
      }
    } catch { /* nothing staged yet, or the directory is unreadable */ }
  })();
}
