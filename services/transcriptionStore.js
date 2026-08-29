import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  addRecording,
  normaliseList,
  patchRecording,
  removeRecording,
  reviveList,
} from '../utils/transcriptionRecordings';

/**
 * transcriptionStore — the recordings list, kept on disk.
 *
 * A transcription outlives the screen that started it: the upload finishes, the
 * GPU takes several minutes, and by then Settings has been closed and quite
 * possibly the app has been killed. What survives that is a job id, which is
 * exactly and only what the pond needs to be asked "is it done yet". So the
 * list is persisted and the panel re-attaches to it, rather than the panel
 * owning state that dies with it.
 *
 * Deliberately module-level rather than a context: nothing else in the app
 * needs to read it, a provider around the whole tree to serve one Settings card
 * is the wrong trade, and `offlineQueue` next door establishes the shape —
 * in-memory truth, AsyncStorage behind it, subscribers notified on change.
 *
 * Writes are fire-and-forget by design. A dropped write costs the ability to
 * re-attach to ONE job, and blocking a progress tick on a disk round trip to
 * avoid that would be the worse bargain.
 */

const STORAGE_KEY = 'turtle:transcriptions:v1';

let recordings = [];
let hydrated = false;
let hydrating = null;
const listeners = new Set();

function publish() {
  for (const listener of listeners) {
    try { listener(recordings); } catch { /* a bad subscriber is not the store's problem */ }
  }
}

async function persist() {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(recordings));
  } catch (error) {
    console.warn('[transcriptions] could not save the recordings list:', error?.message || error);
  }
}

function commit(next) {
  if (next === recordings) return recordings;
  recordings = next;
  publish();
  persist();
  return recordings;
}

/** What is in memory right now, without waiting for disk. */
export function getRecordings() {
  return recordings;
}

/**
 * Read the list back off disk, once.
 *
 * Concurrent callers share one read — the panel mounts and the poller starts in
 * the same tick, and two parallel hydrations would race to publish different
 * versions of the same list.
 */
export async function loadRecordings() {
  if (hydrated) return recordings;
  if (hydrating) return hydrating;
  hydrating = (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      recordings = raw ? reviveList(JSON.parse(raw)) : [];
    } catch (error) {
      // Unreadable storage is an empty history, not a crash on launch.
      console.warn('[transcriptions] could not read the recordings list:', error?.message || error);
      recordings = [];
    }
    hydrated = true;
    hydrating = null;
    publish();
    // A revived row may have been rewritten (an interrupted upload becomes a
    // failure); persist so the next launch does not have to decide again.
    persist();
    return recordings;
  })();
  return hydrating;
}

/** Subscribe to the list. Fires immediately with the current value. */
export function subscribeRecordings(listener) {
  listeners.add(listener);
  listener(recordings);
  return () => listeners.delete(listener);
}

export function addLocalRecording(recording) {
  return commit(addRecording(recordings, recording));
}

export function patchLocalRecording(key, patch) {
  return commit(patchRecording(recordings, key, patch));
}

export function removeLocalRecording(key) {
  return commit(removeRecording(recordings, key));
}

/** Test seam — the module is a singleton and suites must not inherit each other. */
export function __resetForTests(seed = []) {
  recordings = normaliseList(seed);
  hydrated = false;
  hydrating = null;
  listeners.clear();
}
