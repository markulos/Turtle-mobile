/**
 * photoAccessPrompt — asking for the photo library ONCE, and in our own words.
 *
 * Mark, 2026-11-18: "remove the prompt that asks to autosave photos. make it
 * ask once on uploading images but also have a checkmark for never ask again".
 *
 * ── What was asking, and how often ───────────────────────────────────────
 *
 * `VaultUploadContext.processBatch` opened every single upload with a bare
 * `MediaLibrary.requestPermissionsAsync()`. On iOS that is the system sheet
 * carrying our own Info.plist sentence — "Turtle needs access to your photo
 * library to back up and sync your camera roll" — and it was fired
 * unconditionally: for a batch of PDFs with no photo in it, for somebody who
 * had already declined, and, if access was granted as LIMITED, it
 * re-presented the "select more photos" picker at the top of every upload.
 * No way to say no permanently, because a system sheet has nowhere to put
 * one.
 *
 * ── What asks now ────────────────────────────────────────────────────────
 *
 * Turtle's own question, once, and only for a batch that actually has camera
 * roll items in it — with a "Don't ask again" checkmark, which is the half
 * the system sheet could never offer. The OS sheet is only reached by
 * answering yes to ours, so somebody who does not want this is asked exactly
 * one time ever.
 *
 * ── Why it is worth asking at all ────────────────────────────────────────
 *
 * The permission is OPTIONAL to uploading — picker URIs work for the session
 * they were picked in — and buys two things: an interrupted batch can resume
 * (an asset id survives, a picker URI does not), and the pill can offer to
 * clear the originals off the phone once they are safely in the vault. So a
 * No costs those two and nothing else, and the upload must never wait on the
 * answer.
 */

/** Where the decision lives. Bumping the suffix asks everybody again. */
export const PHOTO_ASK_KEY = 'turtle:photoAccessAsk:v1';

const DEFAULTS = { asked: false, never: false };

/**
 * AsyncStorage, required at CALL time rather than imported.
 *
 * This module is reachable from the upload context, which several suites pull
 * in with no AsyncStorage mock; a top-level import makes it their problem.
 */
const storage = () => require('@react-native-async-storage/async-storage').default;

let cache = null;

export async function getPhotoAskState() {
  if (cache) return cache;
  try {
    const raw = await storage().getItem(PHOTO_ASK_KEY);
    cache = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

export async function savePhotoAskState(patch) {
  const next = { ...(await getPhotoAskState()), ...patch };
  cache = next;
  try {
    await storage().setItem(PHOTO_ASK_KEY, JSON.stringify(next));
  } catch {
    // The next launch re-reads. Worst case the question is asked once more,
    // which is a far better failure than never asking and silently losing
    // resume and the delete offer.
  }
  return next;
}

/** Test seam: forget what this process has read. */
export function resetPhotoAskCache() {
  cache = null;
}

/**
 * Is there a camera-roll photo or video in this batch?
 *
 * An `assetId` is the whole test: it is what the picker hands over for the
 * user's OWN library item, and it is also the only thing the permission is
 * any use for. A batch of documents has none, which is why a PDF upload no
 * longer asks about photos.
 */
export function hasLibraryPhotos(items) {
  return (Array.isArray(items) ? items : []).some((item) => !!item?.assetId);
}

/**
 * ONE question, ever — the whole of Mark's request, in one place.
 *
 * `status` is the OS's answer as it stands (`granted` / `denied` /
 * `undetermined` / `limited`).
 */
export function shouldAskPhotoAccess({ status, asked, never, hasPhotos }) {
  if (!hasPhotos) return false;
  // Already ours: asking would be a question with no answer worth giving.
  if (status === 'granted') return false;
  if (never) return false;
  if (asked) return false;
  return true;
}

/** expo-media-library, required at call time for the same reason as storage. */
const library = () => require('expo-media-library');

/**
 * Whoever is drawing the question.
 *
 * A module-level channel rather than a value on VaultUploadContext: that
 * context ticks with upload progress, and a sheet that re-renders on every
 * percentage point to show one unchanging sentence is a waste of every frame
 * of an upload.
 */
const askListeners = new Set();
let asking = false;

export function onPhotoAccessAsk(listener) {
  if (typeof listener !== 'function') return () => {};
  askListeners.add(listener);
  // Immediately, with the state as it already is — a sheet that mounts after
  // the question went up has to show it. Guarded like the broadcast below:
  // this runs inside a component's mount effect, and an upload is not a thing
  // to take down from here.
  try {
    listener(asking);
  } catch {
    /* ignore */
  }
  return () => askListeners.delete(listener);
}

const announce = (next) => {
  asking = next;
  for (const listener of askListeners) {
    try {
      listener(next);
    } catch {
      // One bad subscriber must not stop the others hearing it.
    }
  }
};

/**
 * Put the question up if it is due. Resolves to whether it was.
 *
 * Never awaited by the uploader: the permission is optional and the bytes
 * must start moving whatever the answer turns out to be.
 */
export async function askPhotoAccessIfDue(items) {
  if (asking) return false;
  const hasPhotos = hasLibraryPhotos(items);
  if (!hasPhotos) return false;
  let status = 'undetermined';
  try {
    ({ status } = await library().getPermissionsAsync());
  } catch {
    // No module, no library (a simulator without Photos): treat as unknown
    // rather than skipping the question outright.
  }
  const { asked, never } = await getPhotoAskState();
  if (!shouldAskPhotoAccess({ status, asked, never, hasPhotos })) return false;
  announce(true);
  return true;
}

/**
 * The answer. `allow` reaches the system sheet; `never` is the checkmark.
 *
 * `asked` is recorded on EITHER answer — "once" means once, so a Not now is
 * not a question postponed to the next upload. The checkmark is still worth
 * having beside it: it is the difference between "I may change my mind in
 * Settings" and "stop", and it is what Mark asked for.
 */
export async function answerPhotoAccessAsk({ allow = false, never = false } = {}) {
  announce(false);
  await savePhotoAskState({ asked: true, never: !!never });
  if (!allow) return false;
  try {
    const { status } = await library().requestPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

/** Test seam: drop subscribers and lower the sheet. */
export function resetPhotoAskChannel() {
  askListeners.clear();
  asking = false;
}
