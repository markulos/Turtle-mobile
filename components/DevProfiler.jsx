import React from 'react';
import gestureProbe from '../utils/gestureProbe';

/**
 * DevProfiler — a React.Profiler that reports slow commits to the gesture probe.
 *
 * The probe's drift monitor can say "the JS thread was gone for 350ms"; it
 * cannot say which tree spent it. This closes that gap: any commit past
 * RENDER_MS lands in the findings list as a `slow-render` row carrying the tree
 * id and the phase (mount vs update — a list batch versus a state change).
 *
 * Outside __DEV__ this is the identity function: no Profiler node is created, so
 * a release build carries no measurement overhead whatsoever.
 */
export const DevProfiler = __DEV__
  ? ({ id, children }) => (
    <React.Profiler
      id={id}
      onRender={(profId, phase, actualDuration) => gestureProbe.commit(profId, phase, actualDuration)}
    >
      {children}
    </React.Profiler>
  )
  : ({ children }) => children;

export default DevProfiler;
