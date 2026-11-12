import React from 'react';
import { Text } from 'react-native';
import { act, render } from '@testing-library/react-native';

import {
  holdEdgeSwipe,
  useSuppressEdgeSwipe,
  useEdgeSwipeSuppressed,
  __resetEdgeSwipeGuard,
} from '../edgeSwipeGuard';

// A component rather than renderHook: renderHook is unusable under this
// project's jest setup, and a probe that renders the value is what every other
// store test here does anyway.
function Probe() {
  return <Text testID="held">{String(useEdgeSwipeSuppressed())}</Text>;
}

function Sheet({ visible }) {
  useSuppressEdgeSwipe(visible);
  return <Probe />;
}

const held = (api) => api.getByTestId('held').props.children;

beforeEach(() => __resetEdgeSwipeGuard());

describe('the edge-swipe guard', () => {
  test('is off until something takes it, and off again when that lets go', async () => {
    const api = await render(<Probe />);
    expect(held(api)).toBe('false');

    let release;
    await act(async () => { release = holdEdgeSwipe(); });
    expect(held(api)).toBe('true');

    await act(async () => { release(); });
    expect(held(api)).toBe('false');
  });

  test('COUNTS: the second holder letting go does not free the first', async () => {
    // A colour sheet open while the dock is being dragged. Held as a boolean,
    // the drag ending would re-arm the back-swipe under a sheet still up.
    const api = await render(<Probe />);
    let a; let b;
    await act(async () => { a = holdEdgeSwipe(); });
    await act(async () => { b = holdEdgeSwipe(); });

    await act(async () => { b(); });
    expect(held(api)).toBe('true');
    await act(async () => { a(); });
    expect(held(api)).toBe('false');
  });

  test('a release called twice is not two releases', async () => {
    // A gesture that fires both onEnd and onFinalize. Decrementing twice would
    // put the count NEGATIVE and silently swallow the next real hold — and
    // that failure shows up somewhere else entirely, long after the cause.
    const api = await render(<Probe />);
    let a; let b;
    await act(async () => { a = holdEdgeSwipe(); });
    await act(async () => { b = holdEdgeSwipe(); });

    await act(async () => { a(); a(); a(); });
    expect(held(api)).toBe('true');
    await act(async () => { b(); });
    expect(held(api)).toBe('false');

    let c;
    await act(async () => { c = holdEdgeSwipe(); });
    expect(held(api)).toBe('true');
    await act(async () => { c(); });
    expect(held(api)).toBe('false');
  });

  test('a sheet holds it for as long as it is open, and frees it on unmount', async () => {
    const api = await render(<Sheet visible />);
    expect(held(api)).toBe('true');

    // Closed without unmounting — a sheet whose host keeps it rendered.
    await act(async () => { api.rerender(<Sheet visible={false} />); });
    expect(held(api)).toBe('false');

    await act(async () => { api.rerender(<Sheet visible />); });
    expect(held(api)).toBe('true');

    // Unmounted mid-open. A leak here would kill back-navigation app-wide for
    // the rest of the session, with nothing on screen to explain it.
    await act(async () => { api.unmount(); });
    const after = await render(<Probe />);
    expect(held(after)).toBe('false');
  });
});
