/**
 * The transcript that reads along with the audio.
 *
 * What's asserted is the behaviour that makes it useful rather than decorative:
 * the line being spoken is outlined, the outline MOVES with the clock, and
 * tapping a line takes the audio there.
 */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import FollowAlongTranscript from '../FollowAlongTranscript';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../../utils/haptics', () => ({ tapHaptic: jest.fn() }));

const theme = {
  mode: 'light',
  colors: {
    textPrimary: '#111', textSecondary: '#555', textTertiary: '#888', textMuted: '#999',
    surfaceElevated: '#f4f4f5',
  },
};

const TURNS = [
  { start: 0, end: 2.5, text: 'Morning.', speaker: 'Mark' },
  { start: 2.5, end: 6, text: 'Did the deploy go out?', speaker: 'Mark' },
  { start: 10, end: 14, text: 'It did, about an hour ago.', speaker: 'Person 2' },
];

const flat = (s) => (Array.isArray(s) ? Object.assign({}, ...s.filter(Boolean)) : (s || {}));

/** The border colour the row carrying `text` is drawn with. */
const outlineOf = (view, text) => {
  const node = view.getByText(text);
  let walker = node.parent;
  while (walker) {
    const st = flat(walker.props?.style);
    if (st.borderWidth && st.borderColor) return st.borderColor;
    walker = walker.parent;
  }
  return null;
};

describe('FollowAlongTranscript', () => {
  test('outlines the line being spoken, in the page\'s ink', async () => {
    const view = await render(
      <FollowAlongTranscript turns={TURNS} position={3} onSeek={jest.fn()} theme={theme} />,
    );
    expect(outlineOf(view, 'Did the deploy go out?')).toBe('#000000');
    // And nothing else is outlined.
    expect(outlineOf(view, 'Morning.')).toBe('transparent');
  });

  test('the outline is WHITE on a dark page — "black" means the page\'s ink', async () => {
    const view = await render(
      <FollowAlongTranscript
        turns={TURNS}
        position={3}
        onSeek={jest.fn()}
        theme={{ ...theme, mode: 'dark' }}
      />,
    );
    expect(outlineOf(view, 'Did the deploy go out?')).toBe('#FFFFFF');
  });

  test('the outline moves as the audio plays', async () => {
    const view = await render(
      <FollowAlongTranscript turns={TURNS} position={1} onSeek={jest.fn()} theme={theme} />,
    );
    expect(outlineOf(view, 'Morning.')).toBe('#000000');

    await view.rerender(
      <FollowAlongTranscript turns={TURNS} position={12} onSeek={jest.fn()} theme={theme} />,
    );
    expect(outlineOf(view, 'Morning.')).toBe('transparent');
    expect(outlineOf(view, 'It did, about an hour ago.')).toBe('#000000');
  });

  test('tapping a line seeks the audio to it', async () => {
    const onSeek = jest.fn();
    const view = await render(
      <FollowAlongTranscript turns={TURNS} position={0} onSeek={onSeek} theme={theme} />,
    );
    await fireEvent.press(view.getByText('It did, about an hour ago.'));
    // A hair before the line, so its first word isn't clipped.
    expect(onSeek).toHaveBeenCalledWith(9.85);
  });

  test('a run by one speaker is not re-labelled on every line', async () => {
    const view = await render(
      <FollowAlongTranscript turns={TURNS} position={0} onSeek={jest.fn()} theme={theme} />,
    );
    // Mark says the first two lines; his name appears once.
    expect(view.getAllByText('Mark')).toHaveLength(1);
    expect(view.getAllByText('Person 2')).toHaveLength(1);
  });

  test('an expired transcript says so instead of looking empty', async () => {
    const view = await render(
      <FollowAlongTranscript
        turns={null}
        error="The pond no longer keeps this transcript."
        onSeek={jest.fn()}
        theme={theme}
      />,
    );
    expect(view.getByText('The pond no longer keeps this transcript.')).toBeTruthy();
  });

  test('and an empty one is its own sentence, not an error', async () => {
    const view = await render(
      <FollowAlongTranscript turns={[]} onSeek={jest.fn()} theme={theme} />,
    );
    expect(view.getByText('This transcript came back empty.')).toBeTruthy();
  });
});
