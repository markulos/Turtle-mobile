import React, { useEffect, useState } from 'react';
import { InteractionManager } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

import TabSkeleton from './TabSkeleton';

/**
 * withTabSkeleton — paint the tab's template THIS frame, mount the real screen
 * on the next one.
 *
 * ── What it actually buys ───────────────────────────────────────────────────
 *
 * Nothing gets faster. A 5,000-line screen takes exactly as long to mount as
 * it did. What changes is what is on screen while it does: the template commits
 * on its own, in one cheap pass, and the heavy mount happens behind it. So the
 * tap answers immediately and the page fills in, instead of the old tab
 * sitting there for the whole mount and the new one snapping in at the end.
 *
 * ── Why deferring is safe here, when `lazy: false` was not ─────────────────
 *
 * App.js records the reverted experiment: mounting screens at boot made them
 * measure their layouts against a hidden container (zero-height grids,
 * mis-sized scrubbers). This is the opposite shape — the screen still mounts
 * VISIBLE and focused, one interaction later, so every measurement it takes is
 * taken against the box it is actually in.
 *
 * ── Why it waits on INTERACTIONS and not a timer ───────────────────────────
 *
 * Because of the dock's drag. A thumb scrubbing across the dock focuses each
 * tab it passes for a few frames; `runAfterInteractions` plus DockTabBar's
 * interaction hold means those tabs paint their template and never start the
 * mount at all — the one you stop on is the one that loads. A tab that loses
 * focus before its turn comes cancels, and will mount the next time it is
 * opened for real.
 *
 * The timer alongside it is a backstop, not the mechanism: an interaction
 * handle leaked ANYWHERE in the app would otherwise leave every unopened tab
 * showing its template forever. Whichever fires first wins.
 */

// Long enough that a real drag (or a press-and-hold on a tab) is still covered
// by the interaction queue, short enough that a leaked handle costs one blink
// rather than the session.
const BACKSTOP_MS = 400;

export function withTabSkeleton(Component, kind) {
  const Framed = (props) => {
    const focused = useIsFocused();
    // Once the real screen is up it stays up: this is about the FIRST paint of
    // a tab, not a loading state to return to. Re-entering a mounted tab must
    // not flash a template over content that is already there.
    const [ready, setReady] = useState(false);

    useEffect(() => {
      if (ready || !focused) return;
      const task = InteractionManager.runAfterInteractions(() => setReady(true));
      const backstop = setTimeout(() => setReady(true), BACKSTOP_MS);
      return () => {
        task.cancel();
        clearTimeout(backstop);
      };
    }, [focused, ready]);

    if (!ready) return <TabSkeleton kind={kind} live={focused} />;
    return <Component {...props} />;
  };
  // A stable displayName for the same reason withTabTiming has one: these are
  // built once at module scope, and the name is what identifies the tab in a
  // profiler trace or an error boundary's report.
  Framed.displayName = `TabFramed(${kind})`;
  return Framed;
}

export default withTabSkeleton;
