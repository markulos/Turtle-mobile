/**
 * copyText — put a string on the clipboard, falling back to the OS share sheet.
 *
 * `expo-clipboard` is a NATIVE module: it only exists in a binary compiled
 * after the dependency was added. Requiring it LAZILY (at call time, not at
 * import time) is what lets an older build degrade to sharing instead of dying
 * on the import — `PondInvitesSection` and `TurtleScreen` both already do this
 * by hand, and each rediscovered it the hard way. This is that idiom in one
 * place so the next caller doesn't have to.
 *
 * Returns 'copied' | 'shared' | 'none' rather than a boolean, because those are
 * three different things to tell the user: the text is on their clipboard, the
 * share sheet took it somewhere, or nothing happened at all.
 */
import { Share } from 'react-native';

export async function copyText(text) {
  const value = String(text ?? '');
  // Nothing to put anywhere — and an empty share sheet is worse than no-op.
  if (!value) return 'none';

  let clip = null;
  try { clip = require('expo-clipboard'); } catch { /* not in this build */ }
  if (clip?.setStringAsync) {
    try {
      await clip.setStringAsync(value);
      return 'copied';
    } catch { /* present but failed — fall through to sharing */ }
  }

  try {
    // `dismissedAction` is a perfectly normal outcome (the user backed out), so
    // it is not reported as a copy — the caller should say nothing happened.
    const res = await Share.share({ message: value });
    return res?.action === Share.dismissedAction ? 'none' : 'shared';
  } catch {
    return 'none';
  }
}

export default copyText;
