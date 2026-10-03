// The byline on a note card: the author's name, then their face with everyone
// the note is shared with overlapping behind it, pinned to the card's right edge.
//
// FaceStack is rendered for real rather than mocked — the overlap and the
// first-on-top z-order ARE the feature here, and a mock would assert that props
// were passed rather than that the row looks right.
import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));

const mockPeople = { current: new Map() };
jest.mock('../../../utils/usePondPeople', () => ({
  __esModule: true,
  default: () => mockPeople.current,
}));

const theme = {
  colors: {
    background: '#000', surfaceHighlight: '#333',
    textPrimary: '#fff', textSecondary: '#aaa',
  },
};
jest.mock('../../../context/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme.current }) }));
jest.mock('../../../context/ServerContext', () => ({
  useServer: () => ({ getBaseUrl: () => 'http://pond.local/api' }),
}));
const mockTheme = { current: theme };

import NoteByline, { BYLINE_FACE } from '../NoteByline';

const AUTHOR = { userId: 'u1', name: 'Mark', avatarUrl: '/api/avatars/u1.jpg' };

const note = (over = {}) => ({ id: 'n1', sharedBy: AUTHOR, involvedUsers: [], ...over });

/** Flatten a style prop, however it was composed. */
const flat = (style) => (Array.isArray(style)
  ? Object.assign({}, ...style.flat(9).filter(Boolean))
  : (style || {}));

/**
 * Every disc in the row, in layout order — walked off the rendered tree, the way
 * TimelineTaskRow's tests measure their row.
 *
 * A face is the RINGED wrapper: a BYLINE_FACE square, half-side radius, and a
 * border. The ring is what the test keys on because it is the thing that makes
 * one disc readable against the one it overlaps — and because AnimalAvatar draws
 * its own unringed disc of the same size INSIDE each wrapper, so matching on size
 * alone counts every face twice.
 */
const faces = (view) => {
  const found = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    const st = flat(node.props?.style);
    if (st.width === BYLINE_FACE
      && st.height === BYLINE_FACE
      && st.borderRadius === BYLINE_FACE / 2
      && st.borderWidth > 0) {
      found.push(st);
    }
    (node.children || []).forEach(walk);
  };
  walk(view.toJSON());
  return found;
};

beforeEach(() => {
  mockPeople.current = new Map([
    ['u2', { userId: 'u2', name: 'Ada', avatarUrl: '/api/avatars/u2.jpg' }],
    ['u3', { userId: 'u3', name: 'Grace', avatarUrl: null }],
  ]);
  mockTheme.current = theme;
});

it('shows one face and the name for a note nobody else is on', async () => {
  const view = await render(<NoteByline note={note()} />);
  expect(faces(view)).toHaveLength(1);
  expect(view.getByTestId('note-byline-name').props.children).toBe('Mark');
});

it('draws a face per person — the author plus everyone shared with', async () => {
  const view = await render(<NoteByline note={note({ involvedUsers: ['u2', 'u3'] })} />);
  expect(faces(view)).toHaveLength(3);
});

it('OVERLAPS each face onto the one before it, and only after the first', async () => {
  const view = await render(<NoteByline note={note({ involvedUsers: ['u2', 'u3'] })} />);
  const row = faces(view);
  expect(row[0].marginLeft).toBe(0);
  // A negative left margin IS the overlap — a third of the disc, by faceStack's
  // overlapFor. Anything >= 0 here means the discs sit side by side.
  expect(row[1].marginLeft).toBeLessThan(0);
  expect(row[2].marginLeft).toBe(row[1].marginLeft);
});

it('puts the AUTHOR on top of the people behind them', async () => {
  // Paint order alone would bury the author under whoever was added last, which
  // reads backwards — the first face is the one that should overlap.
  const view = await render(<NoteByline note={note({ involvedUsers: ['u2', 'u3'] })} />);
  const row = faces(view);
  expect(row[0].zIndex).toBeGreaterThan(row[1].zIndex);
  expect(row[1].zIndex).toBeGreaterThan(row[2].zIndex);
});

it('keeps naming the AUTHOR, not whoever is also on the note', async () => {
  const view = await render(<NoteByline note={note({ involvedUsers: ['u2'] })} />);
  expect(view.getByTestId('note-byline-name').props.children).toBe('Mark');
});

it('turns the people who do not fit into a +n rather than widening the row', async () => {
  const view = await render(
    <NoteByline note={note({ involvedUsers: ['u2', 'u3', 'u4', 'u5', 'u6'] })} />,
  );
  // Four FACES is the cap, and the "+n" is a fifth disc beside them — which is
  // why the row's width budget is five discs' worth and not four.
  expect(faces(view)).toHaveLength(5);
  expect(view.getByText('+2')).toBeTruthy();
});

it('shows a fourth FACE rather than spending that disc on the +n', async () => {
  // Exactly four people: no overflow at all, four faces, no badge.
  const view = await render(<NoteByline note={note({ involvedUsers: ['u2', 'u3', 'u4'] })} />);
  expect(faces(view)).toHaveLength(4);
  expect(view.queryByText(/^\+/)).toBeNull();
});

it('says who is on the note out loud, for a reader who cannot see the overlap', async () => {
  const view = await render(<NoteByline note={note({ involvedUsers: ['u2'] })} />);
  expect(view.getByLabelText('Written by Mark, with 1 other person')).toBeTruthy();
});

it('renders nothing for a note with no author at all', async () => {
  const view = await render(<NoteByline note={{ id: 'n1', involvedUsers: ['u2'] }} />);
  expect(view.toJSON()).toBeNull();
});

it('still draws the author before the people map has landed', async () => {
  // The author's name and picture come off the note's own row, so that face
  // never waits on /friends.
  mockPeople.current = new Map();
  const view = await render(<NoteByline note={note({ involvedUsers: ['u2'] })} />);
  expect(faces(view)).toHaveLength(2);
  expect(view.getByTestId('note-byline-name').props.children).toBe('Mark');
});

/**
 * The faces are an ANCHOR, so where they sit is the feature.
 *
 * With the stack leading, the row's right edge was the end of the author's NAME,
 * so the discs landed at a different x on every card and drifted with how long
 * that name happened to be. Trailing them pins the one thing you track down a
 * list of cards.
 */
describe('the stack is pinned to the right edge', () => {
  /** The byline's children, in layout order. */
  const order = (view) => {
    let row = null;
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (!row && node.props?.testID === 'note-byline') row = node;
      (node.children || []).forEach(walk);
    };
    walk(view.toJSON());
    return (row?.children || []).map((child) => (
      typeof child === 'object' && child?.props?.testID === 'note-byline-name' ? 'name' : 'faces'
    ));
  };

  it('puts the name FIRST and the faces LAST', async () => {
    const view = await render(<NoteByline note={note({ involvedUsers: ['u2'] })} />);
    expect(order(view)[0]).toBe('name');
    expect(order(view).at(-1)).toBe('faces');
  });

  it('packs the row to the right, so the edge is the card\'s', async () => {
    const view = await render(<NoteByline note={note()} />);
    let row = null;
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (!row && node.props?.testID === 'note-byline') row = node;
      (node.children || []).forEach(walk);
    };
    walk(view.toJSON());
    expect(flat(row.props.style).justifyContent).toBe('flex-end');
  });

  it('lets the NAME narrow, never the faces — a stack cannot ellipsize', async () => {
    const view = await render(<NoteByline note={note()} />);
    let name = null;
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (!name && node.props?.testID === 'note-byline-name') name = node;
      (node.children || []).forEach(walk);
    };
    walk(view.toJSON());
    const st = flat(name.props.style);
    expect(st.flexShrink).toBe(1);
    expect(st.textAlign).toBe('right');
    expect(name.props.numberOfLines).toBe(1);
  });

  it('draws the faces bigger than the 18pt disc this row started as', async () => {
    expect(BYLINE_FACE).toBeGreaterThan(18);
    const view = await render(<NoteByline note={note()} />);
    expect(faces(view)[0].width).toBe(BYLINE_FACE);
  });
});
