// The bottom-sheet mount latch.
//
// The behaviour worth pinning down is the one that used to be re-typed in every
// sheet and is easy to get subtly wrong: a closing card has to STAY in the tree
// until it has finished sliding out, and then leave — but only if the slide
// actually finished. An interrupted close means something re-opened the sheet
// mid-flight, and unmounting on that would make the reopen pop in from nowhere.
//
// The animation clock is stubbed rather than advanced: what is being tested is
// the latch, not RN Animated's ability to count milliseconds. Stubbing also
// makes "did the close callback fire with finished:false" directly expressible,
// which a real timer cannot do.
//
// Driven through a host component rather than RNTL's renderHook: on this
// React 19 pairing the library's render is ASYNC, so renderHook hands back a
// promise and `result` is never populated. `await render(...)` / `await
// rerender(...)` is the idiom the rest of this suite already uses (see
// TabBarIcon.test.jsx) and the only one that works here.
import React from 'react';
import { act, render } from '@testing-library/react-native';

// Must be `mock`-prefixed to survive jest.mock hoisting.
let mockFinished = true;

jest.mock('../motion', () => {
  const actual = jest.requireActual('../motion');
  return {
    ...actual,
    timing: jest.fn(() => ({
      start: (cb) => cb?.({ finished: mockFinished }),
      stop: jest.fn(),
    })),
    spring: jest.fn(() => ({ start: jest.fn(), stop: jest.fn() })),
  };
});

import { SHEET, timing } from '../motion';
import { useSheetPresentation } from '../useSheetPresentation';

// Latest hook output, captured at render the way renderHook would.
let latest = null;

function Harness(props) {
  latest = useSheetPresentation(props);
  return null;
}

const noop = () => {};

/** Renders the harness and returns an async `show(visible)` that re-renders it. */
async function setup({ visible = false, height = 300, onOpen, onClose = noop } = {}) {
  const view = await render(
    <Harness visible={visible} height={height} onOpen={onOpen} onClose={onClose} />,
  );
  const show = async (next) => {
    await view.rerender(
      <Harness visible={next} height={height} onOpen={onOpen} onClose={onClose} />,
    );
  };
  return { ...view, show };
}

beforeEach(() => {
  mockFinished = true;
  latest = null;
  timing.mockClear();
});

describe('mount latch', () => {
  it('is absent from the tree before it has ever been opened', async () => {
    await setup();
    expect(latest.mounted).toBe(false);
  });

  it('is already mounted when it starts open', async () => {
    await setup({ visible: true });
    expect(latest.mounted).toBe(true);
  });

  it('mounts on open', async () => {
    const { show } = await setup();
    await show(true);
    expect(latest.mounted).toBe(true);
  });

  it('unmounts only once the exit animation has finished', async () => {
    const { show } = await setup({ visible: true });
    expect(latest.mounted).toBe(true);

    await show(false);
    expect(latest.mounted).toBe(false);
  });

  it('stays mounted when the exit is interrupted by a reopen', async () => {
    mockFinished = false;
    const { show } = await setup({ visible: true });

    await show(false);

    // The card is still on screen, mid-slide, ready to be caught by the reopen.
    expect(latest.mounted).toBe(true);
  });

  it('never runs an exit animation for a sheet that was never open', async () => {
    const { show } = await setup();
    await show(false);
    expect(timing).not.toHaveBeenCalled();
  });
});

describe('presentation timing', () => {
  it('enters and leaves on the shared sheet signature', async () => {
    const { show } = await setup();

    await show(true);
    expect(timing).toHaveBeenLastCalledWith(
      expect.anything(),
      1,
      { duration: SHEET.in, easing: SHEET.easing },
    );

    await show(false);
    expect(timing).toHaveBeenLastCalledWith(
      expect.anything(),
      0,
      { duration: SHEET.out, easing: SHEET.easing },
    );
  });
});

describe('onOpen', () => {
  it('fires on every open, so a sheet never reopens holding stale draft state', async () => {
    const onOpen = jest.fn();
    const { show } = await setup({ onOpen });

    await show(true);
    expect(onOpen).toHaveBeenCalledTimes(1);

    await show(false);
    await show(true);
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('does not fire on close', async () => {
    const onOpen = jest.fn();
    const { show } = await setup({ visible: true, onOpen });
    onOpen.mockClear();
    await show(false);
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe('card measurement', () => {
  const layout = (height) => ({ nativeEvent: { layout: { height } } });

  it('starts at the caller\'s seed so the first frame is already off-screen', async () => {
    await setup({ visible: true, height: 420 });
    expect(latest.cardH).toBe(420);
  });

  it('adopts the measured height', async () => {
    await setup({ visible: true });
    await act(async () => { latest.onCardLayout(layout(512)); });
    expect(latest.cardH).toBe(512);
  });

  it('ignores a zero measurement rather than collapsing the slide to nothing', async () => {
    // A card that reports 0 would animate from 0px below its resting place —
    // i.e. not animate at all, and appear fully formed on the first frame.
    await setup({ visible: true, height: 300 });
    await act(async () => { latest.onCardLayout(layout(0)); });
    expect(latest.cardH).toBe(300);
  });

  it('survives a layout event with nothing in it', async () => {
    await setup({ visible: true, height: 300 });
    await act(async () => { latest.onCardLayout({}); });
    expect(latest.cardH).toBe(300);
  });
});

describe('composition with the drag-dismiss hook', () => {
  it('passes the drag plumbing straight through to the caller', async () => {
    await setup({ visible: true });
    expect(latest.panHandlers).toBeDefined();
    expect(latest.scrollProps).toBeDefined();
    expect(typeof latest.scrollPropsFor).toBe('function');
    expect(latest.noDragProps).toBeDefined();
    expect(latest.dragY).toBeDefined();
  });
});
