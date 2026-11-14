import { useCallback } from 'react';
import { runOnUI } from 'react-native-reanimated';
import { CommonActions } from '@react-navigation/native';

import { leadAfterSettle } from './dockMotion';

/**
 * dockNav — the ONE way the dock changes tabs, and the one way the chip is
 * told the outcome.
 *
 * ── What was wrong ─────────────────────────────────────────────────────────
 *
 * A tab change used to be a relay between parties that never met:
 *
 *   the gesture (UI thread) aimed the chip at touch-down;
 *   react-navigation's button (JS) performed the navigate on touch-up;
 *   a 150ms timer checked whether the button had, and navigated if not;
 *   a 600ms timer took the chip back if nothing had;
 *   and an effect, after React had committed, told the chip the new index and
 *   cleared its aim.
 *
 * Every hand-off between them was a guess about timing, and each guess had a
 * way to be wrong that depended on how busy the JS thread was — which is why
 * it read as random:
 *
 *   • the effect cleared the aim UNCONDITIONALLY, late. Tap one tab and then
 *     another before the first commit landed, and the first commit wiped the
 *     second touch's aim: the chip went back to the tab being left, and only
 *     moved again when the second press was finally processed;
 *   • the 600ms timer could fire BEFORE the effect on a slow mount (a timer is
 *     due the moment JS frees up; passive effects flush after), take the chip
 *     back, and then the effect sent it forward again;
 *   • the "button answered" stamp from one tap could land after the next
 *     touch had reset it, so a missed second tap was never completed;
 *   • a touch the SYSTEM cancelled — the swipe up from the home indicator
 *     starts on the dock — was indistinguishable from a tap and changed tabs.
 *
 * ── What it is now ─────────────────────────────────────────────────────────
 *
 * react-navigation keeps its state in a synchronous store: `getState()` is
 * already the new state on the line after `dispatch()`, before React has
 * rendered anything (core/useSyncState). So nobody has to wait to find out
 * what happened, and nobody has to guess:
 *
 *   requestTab   asks for a tab, reads back where the navigator actually is,
 *                and reports both. Idempotent — a request for the tab the
 *                navigator is already on dispatches nothing — so the gesture
 *                and the button can BOTH call it for the same touch, in either
 *                order, and the tab changes once.
 *   settle       tells the chip, on the UI thread, in one job: this is where
 *                the navigator is, and the request for that slot is answered.
 *
 * No timers. The chip's aim is cleared by the answer to its own request, or
 * by the gesture abandoning the touch — never by the clock.
 */

/** The navigator's state right now, or the fallback when there is no store to ask. */
const stateOf = (navigation, fallback) => {
  try {
    const s = typeof navigation?.getState === 'function' ? navigation.getState() : null;
    if (s && Array.isArray(s.routes)) return s;
  } catch {
    // A navigator that is unmounting. The fallback is the last state we saw.
  }
  return fallback || null;
};

/** The focused index right now — what the chip is told is true. -1 = unknown. */
export const currentTabIndex = (navigation, fallback) => {
  const s = stateOf(navigation, fallback);
  return s && Number.isInteger(s.index) ? s.index : -1;
};

/**
 * Go to tab `i`, and tell the chip how that went.
 *
 * `settle(requested, current)` is always called exactly once, including when
 * nothing was dispatched (already there, or no such tab) and when the
 * dispatch throws — a request that is never answered would leave the chip
 * parked on a tab nobody is on.
 */
export function requestTab(navigation, i, settle, fallbackState) {
  let current = -1;
  try {
    const before = stateOf(navigation, fallbackState);
    const route = before?.routes?.[i];
    const moved = !!route && before.index !== i;
    if (moved) {
      // The same action BottomTabBar's own onPress dispatches.
      navigation.dispatch({ ...CommonActions.navigate(route), target: before.key });
    }
    const after = stateOf(navigation, fallbackState);
    current = after && Number.isInteger(after.index) ? after.index : -1;
    // No store to read back from (a bare harness, where the only state is the
    // fallback and a dispatch cannot have changed it): believe the dispatch.
    // With a real store the answer is whatever it says, including "refused".
    if (moved && typeof navigation?.getState !== 'function') current = i;
  } finally {
    settle?.(i, current);
  }
  return current;
}

/**
 * THE PAGE WAITS FOR THE CHIP (see PAGE_FOLLOWS_AT in dockMotion).
 *
 * The dock says, at touch-down, when its chip will have visually landed; a
 * tab request that arrives before then is held until that moment and then
 * made exactly as it would have been. This delays a request — it never
 * decides one: nothing is dropped, reordered or guessed, and `requestTab`
 * is idempotent, so the gesture's request and the button's can both wait
 * out the same gate and the tab still changes once.
 *
 * Module state, because there is one dock and two callers (the gesture in
 * DockTabBar, the button's listener in App.js) that must see the same gate.
 * Bounded: a gate further away than the longest travel is ignored rather
 * than trusted, so a bad clock can never hold a tab change hostage.
 */
const PAGE_WAIT_MIN_MS = 4;
const PAGE_WAIT_MAX_MS = 400;
let pageClearAt = 0;

export function holdPageUntil(timestamp) {
  pageClearAt = Number.isFinite(timestamp) ? timestamp : 0;
}

export function requestTabWhenClear(navigation, i, settle, fallbackState) {
  const wait = pageClearAt - Date.now();
  if (wait > PAGE_WAIT_MIN_MS && wait <= PAGE_WAIT_MAX_MS) {
    setTimeout(() => {
      try {
        requestTab(navigation, i, settle, fallbackState);
      } catch {
        // A navigator that went away while the chip was landing. requestTab
        // has already answered the chip (its finally), which is all that is
        // owed.
      }
    }, wait);
    return -1;
  }
  return requestTab(navigation, i, settle, fallbackState);
}

/**
 * `settle(requested, current)` for a pair of shared values: the chip's lead,
 * and its copy of the navigator's index. One UI-thread job, index first — the
 * chip's driver must never see a spent lead beside a stale index, which is a
 * whole travel backwards (see chipAim's handover tests).
 *
 * `current < 0` means "nobody could say where the navigator is"; the index is
 * then left alone and only the lead is answered.
 */
export function useDockSettle(lead, navSlot) {
  return useCallback((requested, current) => {
    runOnUI(() => {
      'worklet';
      if (current >= 0) navSlot.value = current;
      lead.value = leadAfterSettle(lead.value, requested, current);
    })();
  }, [lead, navSlot]);
}
