import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../../../../utils/haptics', () => ({ notifyHaptic: jest.fn(), tapHaptic: jest.fn() }));
jest.mock('../../../../context/ThemeContext', () => ({
  useTheme: () => ({
    theme: { mode: 'dark', colors: new Proxy({}, { get: (_, k) => `#${String(k).slice(0, 6)}` }) },
  }),
}));

import ClaudeSessionControls from '../ClaudeSessionControls';

/**
 * THE PILL IS THE TOGGLE.
 *
 * The corner used to carry a pill reading "live" and, beside it, a button
 * reading "Live" — the readout and the switch, which is a distinction that
 * only exists in the source. On screen it was the state printed twice in a
 * corner that already has four other controls in it. Mark asked for the two
 * to be one.
 *
 * What is worth pinning is the thing a later refactor would undo without
 * noticing: that there is exactly ONE control carrying that word, and that it
 * still toggles.
 */

const props = (over = {}) => ({
  mode: 'session',
  active: true,
  busy: false,
  live: true,
  onToggleLive: jest.fn(),
  onStop: jest.fn(),
  expanded: false,
  onToggleExpanded: jest.fn(),
  onClose: jest.fn(),
  ...over,
});

/**
 * Every rendered string in the tree, lowercased.
 *
 * Walked off `toJSON()` — this RNTL has no `root.findAll`, and the point of
 * the test is "how many times does this word appear on screen", which no
 * by-text query answers without already knowing the answer.
 */
const words = (view) => {
  const out = [];
  const walk = (n) => {
    if (n == null) return;
    if (typeof n === 'string') { out.push(n.toLowerCase()); return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    walk(n.children);
  };
  walk(view.toJSON());
  return out;
};

describe('the live control', () => {
  test('is ONE control, not a readout and a switch saying the same word', async () => {
    const view = await render(<ClaudeSessionControls {...props()} />);
    expect(words(view).filter((w) => w.includes('live'))).toHaveLength(1);
    // …and it is the pill: there is one of those too.
    expect(view.getAllByTestId('claude-live-pill')).toHaveLength(1);
  });

  test('tapping it pauses the log, and the paused pill offers to resume', async () => {
    const p = props();
    const live = await render(<ClaudeSessionControls {...p} />);
    const pill = live.getByTestId('claude-live-pill');
    // AWAITED. An un-awaited act leaves React's scope open and every later
    // render() in the file quietly returns nothing — three tests below this
    // one went green-to-"cannot find" on exactly that.
    await act(async () => { fireEvent.press(pill); });
    expect(p.onToggleLive).toHaveBeenCalledTimes(1);
    expect(pill.props.accessibilityRole).toBe('button');
    expect(pill.props.accessibilityLabel).toMatch(/pause/i);
    expect(pill.props.accessibilityState).toEqual({ selected: true });

    const paused = await render(<ClaudeSessionControls {...props({ live: false })} />);
    const off = paused.getByTestId('claude-live-pill');
    expect(off.props.accessibilityLabel).toMatch(/resume/i);
    expect(off.props.accessibilityState).toEqual({ selected: false });
    // Still one word for the state, and it is the paused one.
    expect(words(paused).filter((w) => w === 'paused')).toHaveLength(1);
  });

  test('before there is a stream, it is a READOUT — no switch that does nothing', async () => {
    // "starting…" and "signing in…" have no log to pause. A pill that looks
    // tappable and is not is worse than one that plainly is not.
    for (const over of [{ active: false }, { mode: 'login' }, { onToggleLive: undefined }]) {
      const view = await render(<ClaudeSessionControls {...props(over)} />);
      const pill = view.getByTestId('claude-live-pill');
      expect(pill.props.accessibilityRole).toBeUndefined();
      expect(pill.props.onStartShouldSetResponder).toBeUndefined();
    }
  });

  test('the other controls are untouched — this merged two, it did not drop any', async () => {
    const view = await render(<ClaudeSessionControls {...props()} />);
    expect(view.getByLabelText('Stop the Claude session')).toBeTruthy();
    expect(view.getByLabelText(/Expand Claude session/)).toBeTruthy();
    expect(view.getByLabelText('Hide the Claude console')).toBeTruthy();
  });

  test('a login cancels rather than stops, and says so', async () => {
    const view = await render(<ClaudeSessionControls {...props({ mode: 'login' })} />);
    expect(view.getByLabelText('Cancel sign-in')).toBeTruthy();
    expect(words(view)).toContain('signing in…');
  });
});

/**
 * THE KEYS TAKE THE COLOUR OF WHAT THEY ARE ON.
 *
 * Mark, 2026-11-18: in light mode the composer wears the nav bar's backdrop,
 * and these keys live in its top-right corner. They were drawn for the page;
 * on a dark band page ink is invisible (§1). The screen hands them the band's
 * palette and they use it — with none, nothing changes for anywhere else
 * that mounts this.
 *
 * The theme in this file is a Proxy that answers every colour with a token of
 * its own name, which is what makes the rest of the suite readable and what
 * stops this one asserting on a rendered hex. So the two things pinned are
 * the ones that matter and that this harness CAN see: that nothing breaks
 * either way, and that the override MERGES.
 */
describe('the surface these keys are on', () => {
  test('with no ink given, nothing about them changes', async () => {
    const view = await render(<ClaudeSessionControls {...props()} />);
    expect(view.getByTestId('claude-live-pill')).toBeTruthy();
    expect(view.getByLabelText('Stop the Claude session')).toBeTruthy();
  });

  test('a PARTIAL palette does not blank everything it does not mention', async () => {
    // The band hands over six colours and this component reads more than six.
    // A replace rather than a merge leaves the rest `undefined`, which is a
    // corner of invisible keys mid-session.
    const view = await render(<ClaudeSessionControls {...props({ ink: { textPrimary: '#FFFFFF' } })} />);
    expect(view.getByTestId('claude-live-pill')).toBeTruthy();
    expect(view.getByLabelText(/Expand Claude session/)).toBeTruthy();
    expect(view.getByLabelText('Hide the Claude console')).toBeTruthy();

    const src = require('fs').readFileSync(
      require('path').resolve(__dirname, '..', 'ClaudeSessionControls.jsx'), 'utf8',
    );
    expect(src).toMatch(
      /const theme = ink \? \{ \.\.\.pageTheme, colors: \{ \.\.\.pageTheme\.colors, \.\.\.ink \} \} : pageTheme;/,
    );
  });
});
