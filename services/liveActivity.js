// iOS Live Activity for the running pomodoro (Tier 2, Option A).
//
// Uses expo-live-activity (Software Mansion). The timer countdown is rendered
// NATIVELY by iOS from the end date we set once (ProgressView(timerInterval:))
// — no per-second updates, works while the app is backgrounded or killed.
//
// Scope of this version (published lib is 0.4.2): live COUNTDOWN while running
// + a persistent "done" card on completion (which the user dismisses, taps to
// open the app, or acts on via the completion notification's Start-break
// button). A live COUNT-UP "time since last focus" needs elapsedTimer, absent
// from 0.4.2 — that arrives with the planned expo-widgets migration.
//
// expo-live-activity is a NATIVE, iOS-only module. Everything here is guarded
// so that on Android, or before the dev rebuild, every call is a no-op.

import { Platform } from 'react-native';

let LA = null;
if (Platform.OS === 'ios') {
  try {
    // eslint-disable-next-line global-require
    LA = require('expo-live-activity');
  } catch {
    LA = null; // not in this binary yet → no Live Activity, no crash
  }
}

let currentId = null;
let listenerSub = null;

// 'turtle' scheme is registered in app.json → tapping the Live Activity opens
// the app (a return / acknowledge affordance).
const CONFIG = { timerType: 'digital', deepLinkUrl: 'turtle://pomodoro' };

function ensureListener() {
  if (!LA || listenerSub || !LA.addActivityUpdatesListener) return;
  // Drop our handle once the system dismisses/ends the activity so the next
  // run starts a fresh one instead of updating a dead id.
  listenerSub = LA.addActivityUpdatesListener((e) => {
    if (e && (e.activityState === 'dismissed' || e.activityState === 'ended')) {
      if (!currentId || e.activityID === currentId) currentId = null;
    }
  });
}

// A pomodoro is running — show (or retarget) the live countdown to `endsAt`.
export function showRunning(mode, endsAt) {
  if (!LA || typeof endsAt !== 'number') return;
  ensureListener();
  const state = {
    title: mode === 'break' ? 'Break' : 'Focus',
    subtitle: mode === 'break' ? 'Recharge 🐢' : 'Deep work 🐢',
    progressBar: { date: endsAt },
  };
  try {
    if (currentId) LA.updateActivity(currentId, state);
    else currentId = LA.startActivity(state, CONFIG) || null;
  } catch {
    /* native failure — non-fatal, in-app UI still shows the timer */
  }
}

// The timer finished on its own — leave a persistent "done" card (full bar)
// the user must dismiss or act on. Starts one if none exists (e.g. the app was
// reopened right after completion).
export function showCompleted(mode) {
  if (!LA) return;
  ensureListener();
  const state = {
    title: mode === 'break' ? "Break's over 🐢" : 'Focus complete 🐢',
    subtitle: mode === 'break' ? 'Tap to start focusing' : 'Tap to start your break',
    progressBar: { progress: 1 },
  };
  try {
    if (currentId) LA.updateActivity(currentId, state);
    else currentId = LA.startActivity(state, CONFIG) || null;
  } catch {
    /* non-fatal */
  }
}

// Manual stop / idle / dismissed — tear the activity down.
export function clear() {
  if (!LA || !currentId) return;
  try {
    LA.stopActivity(currentId, { title: 'Pomodoro', progressBar: { progress: 1 } });
  } catch {
    /* non-fatal */
  }
  currentId = null;
}
