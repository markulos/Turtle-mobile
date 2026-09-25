import React from 'react';
import { Text } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';

import { ChromeProvider, useChrome, useHideDock } from '../ChromeContext';

/** Reads the latch, so a test can assert on what App.js's navigator would see. */
function Probe() {
  const { dockHidden } = useChrome();
  return <Text>{dockHidden ? 'DOCK HIDDEN' : 'DOCK SHOWN'}</Text>;
}

function Holder({ active = true }) {
  useHideDock(active);
  return null;
}

describe('ChromeContext', () => {
  it('hides the dock while a page holds it and shows it again on unmount', async () => {
    const { getByText, rerender } = await render(
      <ChromeProvider><Probe /><Holder /></ChromeProvider>
    );
    await waitFor(() => getByText('DOCK HIDDEN'));

    // The reader is UNMOUNTED when it closes, not left mounted with
    // visible=false — so unmount is the path that has to give the dock back.
    await rerender(<ChromeProvider><Probe /></ChromeProvider>);
    await waitFor(() => getByText('DOCK SHOWN'));
  });

  it('an inactive holder takes nothing', async () => {
    const { getByText } = await render(
      <ChromeProvider><Probe /><Holder active={false} /></ChromeProvider>
    );
    await waitFor(() => getByText('DOCK SHOWN'));
  });

  /**
   * Why the latch counts instead of flipping a boolean: with two holders up,
   * the first one to leave must not hand the dock back while the second is
   * still reading.
   */
  it('two holders do not undo each other', async () => {
    const { getByText, rerender } = await render(
      <ChromeProvider><Probe /><Holder /><Holder /></ChromeProvider>
    );
    await waitFor(() => getByText('DOCK HIDDEN'));

    await rerender(<ChromeProvider><Probe /><Holder /></ChromeProvider>);
    await waitFor(() => getByText('DOCK HIDDEN'));

    await rerender(<ChromeProvider><Probe /></ChromeProvider>);
    await waitFor(() => getByText('DOCK SHOWN'));
  });
});
