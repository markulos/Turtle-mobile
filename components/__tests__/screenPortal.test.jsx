/**
 * ScreenPortal — the view goes up, and nothing else moves.
 *
 * Two promises, and the second is the reason this exists rather than the
 * obvious provider-state version:
 *
 *  1. The children render in the HOST, so they can paint over everything the
 *     screen drew before it.
 *  2. Delivering an update re-renders the portalled content and the host, and
 *     NOTHING else on the screen. The day planner's sheet re-renders on every
 *     keystroke in its add-task field; a portal that re-rendered the whole
 *     Planner to deliver that would be a worse version of the lag it was
 *     written to remove.
 */
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import { ScreenPortal, ScreenPortalHost, ScreenPortalProvider } from '../ScreenPortal';

/** The host is the only box-none absolute fill in these trees. */
const hostOf = (view) => {
  let found = null;
  const walk = (node) => {
    if (!node || typeof node !== 'object' || found) return;
    if (node.props?.pointerEvents === 'box-none') { found = node; return; }
    (node.children || []).forEach(walk);
  };
  walk(view.toJSON());
  return found;
};

const textsIn = (node) => {
  const out = [];
  const walk = (n) => {
    if (!n) return;
    if (typeof n === 'string') { out.push(n); return; }
    if (typeof n !== 'object') return;
    (n.children || []).forEach(walk);
  };
  walk(node);
  return out;
};

it('renders the portalled view in the host, not where it was written', async () => {
  const view = await render(
    <ScreenPortalProvider>
      <View>
        <Text>the page</Text>
        <ScreenPortal id="a"><Text>the sheet</Text></ScreenPortal>
      </View>
      <ScreenPortalHost />
    </ScreenPortalProvider>,
  );

  expect(view.getByText('the page')).toBeTruthy();
  // Present — and present INSIDE the host, which is what lets it cover the
  // page above.
  expect(textsIn(hostOf(view))).toContain('the sheet');
});

it('draws nothing at all when nothing is mounted in it', async () => {
  const view = await render(
    <ScreenPortalProvider>
      <Text>the page</Text>
      <ScreenPortalHost />
    </ScreenPortalProvider>,
  );
  expect(hostOf(view)).toBeNull();
});

it('takes the view away again when the portal unmounts', async () => {
  function Screen() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <Text onPress={() => setOpen(false)}>close</Text>
        {open ? <ScreenPortal id="a"><Text>the sheet</Text></ScreenPortal> : null}
      </>
    );
  }
  const view = await render(
    <ScreenPortalProvider>
      <Screen />
      <ScreenPortalHost />
    </ScreenPortalProvider>,
  );
  expect(view.queryByText('the sheet')).toBeTruthy();
  await act(async () => { fireEvent.press(view.getByText('close')); });
  expect(view.queryByText('the sheet')).toBeNull();
});

it('delivers an update without re-rendering the rest of the screen', async () => {
  const renders = { sibling: 0 };
  const Sibling = () => { renders.sibling += 1; return <Text>sibling</Text>; };

  function Sheet() {
    const [n, setN] = useState(0);
    return (
      <>
        <Text onPress={() => setN((x) => x + 1)}>bump</Text>
        <ScreenPortal id="a"><Text>{`count ${n}`}</Text></ScreenPortal>
      </>
    );
  }

  const view = await render(
    <ScreenPortalProvider>
      <Sibling />
      <Sheet />
      <ScreenPortalHost />
    </ScreenPortalProvider>,
  );
  expect(textsIn(hostOf(view))).toContain('count 0');
  const before = renders.sibling;

  await act(async () => { fireEvent.press(view.getByText('bump')); });

  // The new content is up…
  expect(textsIn(hostOf(view))).toContain('count 1');
  // …and the screen beside it never heard about it. This is the assertion that
  // fails if the nodes are ever moved into provider STATE.
  expect(renders.sibling).toBe(before);
});

it('keeps two portals in the order they mounted', async () => {
  const view = await render(
    <ScreenPortalProvider>
      <ScreenPortal id="first"><Text>first</Text></ScreenPortal>
      <ScreenPortal id="second"><Text>second</Text></ScreenPortal>
      <ScreenPortalHost />
    </ScreenPortalProvider>,
  );
  // Order matters for paint: later is on top.
  expect(textsIn(hostOf(view))).toEqual(['first', 'second']);
});
