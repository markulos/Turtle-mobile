/**
 * withTabTiming — how long a tab took to actually appear, measured on device.
 *
 * ─── Why this exists ────────────────────────────────────────────────────────
 *
 * Telemetry knows API durations, JS stalls and cold starts. It has never known
 * anything about NAVIGATION, so "tapping a tab feels slow" could only ever be
 * inferred from timing adjacency — a stall happening to sit near a screen's
 * mount burst. Over three days of prod samples that inference covered barely
 * half the evidence: of 204 stalls past 500ms, 103 had no API traffic anywhere
 * near them, which says the thread was busy rendering but not which screen.
 *
 * `gestureProbe` already answers exactly this question — it pairs a touch-down
 * with a later `respond()` and files the gap as "felt laggy". It just was never
 * pointed at the tab bar: only five call sites report, and every one of them is
 * inside MediaGallery. So the one interaction being complained about is the one
 * interaction the probe could not see.
 *
 * ─── Why the effect, and not a navigation listener ──────────────────────────
 *
 * A `tabPress` or `onStateChange` listener fires when navigation state changes,
 * which is BEFORE the target screen has rendered — it would time the router,
 * not the wait. An effect in the screen itself runs after its commit, so the
 * gap it reports is finger-down to content-on-screen, which is the thing that
 * feels slow.
 *
 * ─── Why nothing needs to mark the press ────────────────────────────────────
 *
 * The global capture handler in App.js already records every touch-down, so
 * `respond` pairs with the real finger landing on the tab rather than with a
 * router event some milliseconds later. It also CONSUMES that touch (one
 * response per gesture) and returns early when there is none — which is what
 * makes this safe on a programmatic navigation, like the chat's "New task"
 * button: no touch, no sample, rather than a phantom paired with whatever the
 * user last tapped.
 *
 * Dev-only in effect: every gestureProbe entry point is an immediate return
 * when __DEV__ is false, so a release build carries a focus subscription and
 * nothing else.
 */
import React, { useEffect, useRef } from 'react';
import { useIsFocused } from '@react-navigation/native';

import gestureProbe from '../utils/gestureProbe';

/** Reports once per focus TRANSITION, not once per render while focused. */
export function useTabReady(name) {
  const focused = useIsFocused();
  // Starts false even though a lazily-mounted screen is focused on its very
  // first render — that first appearance is the slowest one there is and the
  // whole reason for measuring. Seeding from `focused` would silently skip it.
  const reported = useRef(false);

  useEffect(() => {
    if (!focused) { reported.current = false; return; }
    if (reported.current) return;
    reported.current = true;
    gestureProbe.respond(`tab:${name}`);
  }, [focused, name]);
}

export function withTabTiming(Component, name) {
  const Timed = (props) => {
    useTabReady(name);
    return <Component {...props} />;
  };
  Timed.displayName = `TabTimed(${name})`;
  return Timed;
}

export default withTabTiming;
