jest.mock('../../../../utils/haptics', () => ({
  impactHaptic: jest.fn(), notifyHaptic: jest.fn(), tapHaptic: jest.fn(),
}));

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import NowPlayingPanel, { clock, coverSize, fractionAt } from '../NowPlayingPanel';

/**
 * The transport bar, opened out.
 *
 * Mark, 2026-11-18: tapping what is playing should "open as a panel with the
 * album and proper slider element and navigation buttons".
 *
 * The slider's motion lives on the UI thread, which this suite cannot drive —
 * so what is tested is the arithmetic behind it (pure and exported for that
 * reason) and the wiring of every control to the handler the BAR already
 * uses. A second play button that did something subtly different from the
 * first is the failure this feature invites.
 */

const colors = {
  background: '#faf9f2', surface: '#fff', surfaceElevated: '#f3f1e7',
  border: '#ddd', textPrimary: '#111', textSecondary: '#555',
  textTertiary: '#888', textMuted: '#aaa', accent: '#b8b400',
};

const open = (props = {}) => render(
  <NowPlayingPanel
    visible
    title="Being the Beloved"
    subtitle="Audio"
    isPlaying
    position={30}
    duration={300}
    colors={colors}
    tint="#b8b400"
    {...props}
  />,
);

describe('clock', () => {
  test('mm:ss, and an hour when there is one', () => {
    // 8:03 in the screenshot, and the pond is full of hour-long recordings.
    expect(clock(0)).toBe('0:00');
    expect(clock(3)).toBe('0:03');
    expect(clock(483)).toBe('8:03');
    expect(clock(3600)).toBe('1:00:00');
    expect(clock(3723)).toBe('1:02:03');
  });

  test('nothing, or nonsense, reads as zero rather than as NaN', () => {
    for (const junk of [undefined, null, NaN, -5, 'x']) expect(clock(junk)).toBe('0:00');
  });
});

describe('fractionAt', () => {
  test('a position along the track, clamped at both ends', () => {
    expect(fractionAt(0, 200)).toBe(0);
    expect(fractionAt(100, 200)).toBe(0.5);
    expect(fractionAt(200, 200)).toBe(1);
    // A finger that leaves the track does not seek past the end, or before
    // the start — which a drag that starts mid-thumb will do.
    expect(fractionAt(-40, 200)).toBe(0);
    expect(fractionAt(400, 200)).toBe(1);
  });

  test('before layout there is no track to be a fraction of', () => {
    expect(fractionAt(50, 0)).toBe(0);
    expect(fractionAt(50, -1)).toBe(0);
  });
});

describe('coverSize', () => {
  test('as big as the narrow side allows, and never taller than it is wide', () => {
    const phone = coverSize(390, 844);
    expect(phone).toBe(326);
    expect(phone).toBeLessThanOrEqual(390 - 64);
  });

  test('A SHORT SCREEN GIVES WAY — the keys matter more than the cover', () => {
    // On an SE a cover sized off the width alone pushes the slider and the
    // transport under the home bar.
    const se = coverSize(375, 667);
    expect(se).toBeLessThan(375 - 64);
    expect(se).toBeLessThanOrEqual(Math.round(667 * 0.42));
  });

  test('…and it is capped, so a tablet does not get one enormous square', () => {
    expect(coverSize(1024, 1366)).toBe(340);
  });
});

describe('the panel', () => {
  test('is nothing at all until it is opened', async () => {
    const view = await render(
      <NowPlayingPanel visible={false} title="x" colors={colors} tint="#b8b400" />,
    );
    expect(view.queryByTestId('now-playing-panel')).toBeNull();
  });

  test('shows the album, the name, a slider and three keys', async () => {
    const view = await open({ artworkUri: 'https://pond/art.jpg' });
    expect(view.getByTestId('now-playing-art')).toBeTruthy();
    expect(view.getByText('Being the Beloved')).toBeTruthy();
    expect(view.getByTestId('now-playing-slider')).toBeTruthy();
    expect(view.getByTestId('now-playing-previous-track')).toBeTruthy();
    expect(view.getByTestId('now-playing-toggle')).toBeTruthy();
    expect(view.getByTestId('now-playing-next-track')).toBeTruthy();
  });

  test('NO COVER IS THE COMMON CASE, and it draws its own frame for it', async () => {
    // A voice memo, a file off a phone, a download with no embedded art.
    const view = await open();
    expect(view.queryByTestId('now-playing-art')).toBeNull();
    expect(view.getByTestId('now-playing-art-empty')).toBeTruthy();
  });

  test('both ends of the track are on screen', async () => {
    const view = await open({ position: 30, duration: 483 });
    expect(view.getByText('8:03')).toBeTruthy();
    // The elapsed end is an animated TextInput — it carries the value the
    // UI thread writes, not a rendered string.
    expect(view.getByTestId('now-playing-elapsed')).toBeTruthy();
  });

  test('every key calls the handler the BAR calls', async () => {
    const onPrev = jest.fn();
    const onNext = jest.fn();
    const onToggle = jest.fn();
    const view = await open({ canPrev: true, canNext: true, onPrev, onNext, onToggle });

    await fireEvent.press(view.getByTestId('now-playing-previous-track'));
    await fireEvent.press(view.getByTestId('now-playing-next-track'));
    await fireEvent.press(view.getByTestId('now-playing-toggle'));
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  test('…and the ends of a queue are DEAD keys, as they are on the bar', async () => {
    const onPrev = jest.fn();
    const onNext = jest.fn();
    const view = await open({ canPrev: false, canNext: false, onPrev, onNext });
    await fireEvent.press(view.getByTestId('now-playing-previous-track'));
    await fireEvent.press(view.getByTestId('now-playing-next-track'));
    expect(onPrev).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
    expect(view.getByTestId('now-playing-previous-track').props.accessibilityState.disabled).toBe(true);
  });

  test('the key says PLAY while the audio is still being found', async () => {
    // Same rule as the bar: a pause glyph over silence is the thing that
    // makes somebody press it again and restart the wait.
    const view = await open({ isPlaying: true, preparing: true });
    expect(view.getByLabelText('Loading')).toBeTruthy();
  });

  test('it closes from the chevron and from the scrim', async () => {
    const onClose = jest.fn();
    const view = await open({ onClose });
    await fireEvent.press(view.getByTestId('now-playing-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
    // The scrim carries the same label — by id, so this is not asking which.
    await fireEvent.press(view.getByTestId('now-playing-scrim'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  test('a track of unknown length cannot be scrubbed', async () => {
    // Seeking against a duration of zero is a seek to zero — it would throw
    // you back to the start of something that had barely begun.
    const onSeek = jest.fn();
    const view = await open({ duration: 0, onSeek });
    expect(view.getByTestId('now-playing-slider')).toBeTruthy();
    expect(onSeek).not.toHaveBeenCalled();
  });
});
