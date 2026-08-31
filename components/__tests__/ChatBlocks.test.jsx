import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import ChatBlocks from '../ChatBlocks';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

const theme = {
  spacing: { xs: 4, sm: 8, md: 12 },
  colors: {
    surface: '#0a0a0a',
    surfaceElevated: '#111',
    border: '#222',
    accent: '#3DDC97',
    accentInfo: '#3DDC97',
    accentError: '#F87171',
    accentSuccess: '#34D399',
    onPrimary: '#000',
    textPrimary: '#fff',
    textSecondary: '#aaa',
    textTertiary: '#888',
    textMuted: '#666',
  },
};

const apiOf = (post = jest.fn(() => Promise.resolve({ success: true }))) => ({ post });

const READ_BLOCK = {
  id: 'b0',
  kind: 'actions',
  title: 'Tasks',
  actions: [{
    id: 'b0.a0', kind: 'call', label: 'Show my tasks', style: 'default',
    method: 'GET', path: '/api/tasks', risk: 'read', signature: 'GET /api/tasks', confirm: false,
  }],
};

const WRITE_BLOCK = {
  id: 'b1',
  kind: 'actions',
  actions: [{
    id: 'b1.a0', kind: 'call', label: 'Add it', style: 'primary',
    method: 'POST', path: '/api/tasks/single', body: { title: 'Ring the vet' },
    risk: 'write', signature: 'POST /api/tasks/single', confirm: true,
    effect: 'POST /api/tasks/single — Create ONE task.',
  }],
};

const renderBlocks = (blocks, props = {}) => render(
  <ChatBlocks blocks={blocks} theme={theme} api={apiOf()} onAsk={jest.fn()} onNavigate={jest.fn()} {...props} />,
);

describe('ChatBlocks', () => {
  test('a read runs on a single press', async () => {
    const post = jest.fn(() => Promise.resolve({ success: true }));
    const view = await renderBlocks([READ_BLOCK], { api: apiOf(post) });

    await fireEvent.press(view.getByText('Show my tasks'));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith('/turtle/chat/action', {
      action: {
        kind: 'call',
        label: 'Show my tasks',
        method: 'GET',
        path: '/api/tasks',
        query: undefined,
        body: undefined,
        confirmed: false,
      },
    });
  });

  test('a write does NOT run on the first press — it arms', async () => {
    // The whole safety property. A button whose label was written by a model
    // must not change data until the user has seen what it really does.
    const post = jest.fn(() => Promise.resolve({ success: true }));
    const view = await renderBlocks([WRITE_BLOCK], { api: apiOf(post) });

    await fireEvent.press(view.getByText('Add it'));

    expect(post).not.toHaveBeenCalled();
    // Arming reveals the effect the SERVER computed from the resolved route,
    // which is the part the label cannot lie about.
    expect(view.getByText('POST /api/tasks/single — Create ONE task.')).toBeTruthy();
    expect(view.getByText('Yes — Add it')).toBeTruthy();
    expect(view.getByText('Cancel')).toBeTruthy();
  });

  test('the second press runs it, and says it was confirmed', async () => {
    const post = jest.fn(() => Promise.resolve({ success: true }));
    const view = await renderBlocks([WRITE_BLOCK], { api: apiOf(post) });

    await fireEvent.press(view.getByText('Add it'));
    await fireEvent.press(view.getByText('Yes — Add it'));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [, payload] = post.mock.calls[0];
    expect(payload.action.confirmed).toBe(true);
    expect(payload.action.body).toEqual({ title: 'Ring the vet' });
  });

  test('cancel puts the button back without running anything', async () => {
    const post = jest.fn(() => Promise.resolve({ success: true }));
    const view = await renderBlocks([WRITE_BLOCK], { api: apiOf(post) });

    await fireEvent.press(view.getByText('Add it'));
    await fireEvent.press(view.getByText('Cancel'));

    expect(post).not.toHaveBeenCalled();
    expect(view.getByText('Add it')).toBeTruthy();
    expect(view.queryByText('Cancel')).toBeNull();
  });

  test('a failure shows the server’s own message', async () => {
    // Not a generic one: the server's text is the only thing that says what
    // actually went wrong, and the user is the one who has to act on it.
    const post = jest.fn(() => Promise.resolve({ success: false, error: 'Task title is required' }));
    const view = await renderBlocks([READ_BLOCK], { api: apiOf(post) });

    await fireEvent.press(view.getByText('Show my tasks'));

    await waitFor(() => expect(view.getByText('Task title is required')).toBeTruthy());
  });

  test('a thrown request is reported rather than swallowed', async () => {
    const post = jest.fn(() => Promise.reject(new Error('Network request failed')));
    const view = await renderBlocks([READ_BLOCK], { api: apiOf(post) });

    await fireEvent.press(view.getByText('Show my tasks'));

    await waitFor(() => expect(view.getByText('Network request failed')).toBeTruthy());
  });

  test('an ask button types for the user instead of calling the server', async () => {
    const onAsk = jest.fn();
    const post = jest.fn();
    const block = {
      id: 'b0',
      kind: 'actions',
      actions: [{ id: 'b0.a0', kind: 'ask', label: 'Just the overdue ones', style: 'default', text: 'show only overdue tasks' }],
    };
    const view = await renderBlocks([block], { api: apiOf(post), onAsk });

    await fireEvent.press(view.getByText('Just the overdue ones'));

    expect(onAsk).toHaveBeenCalledWith('show only overdue tasks');
    expect(post).not.toHaveBeenCalled();
  });

  test('an open button navigates, and an unknown screen says so', async () => {
    const onNavigate = jest.fn();
    const block = {
      id: 'b0',
      kind: 'actions',
      actions: [
        { id: 'b0.a0', kind: 'open', label: 'Open photos', style: 'default', screen: 'photos' },
        { id: 'b0.a1', kind: 'open', label: 'Open downloads', style: 'default', screen: 'downloads' },
      ],
    };
    const view = await renderBlocks([block], { onNavigate });

    await fireEvent.press(view.getByText('Open photos'));
    expect(onNavigate).toHaveBeenCalledWith('Photos', undefined);

    // 'downloads' is a web-app screen; here it lives inside the Turtle tab.
    await fireEvent.press(view.getByText('Open downloads'));
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(view.getByText('That screen isn\'t in this app.')).toBeTruthy();
  });

  test('a form will not submit until its required fields are filled', async () => {
    const post = jest.fn(() => Promise.resolve({ success: true }));
    const block = {
      id: 'b0',
      kind: 'form',
      title: 'New task',
      fields: [
        { id: 'f0', name: 'title', label: 'Task', type: 'text', required: true },
        { id: 'f1', name: 'duration', label: 'Minutes', type: 'number' },
      ],
      submit: {
        id: 'b0.a0', kind: 'call', label: 'Add task', style: 'primary',
        method: 'POST', path: '/api/tasks/single', risk: 'write',
        signature: 'POST /api/tasks/single', confirm: true, effect: 'POST /api/tasks/single',
      },
    };
    const view = await renderBlocks([block], { api: apiOf(post) });

    expect(view.getByText('Fill in: Task')).toBeTruthy();
    await fireEvent.press(view.getByText('Add task'));
    expect(post).not.toHaveBeenCalled();

    await fireEvent.changeText(view.getByLabelText('Task'), 'Ring the vet');
    await fireEvent.changeText(view.getByLabelText('Minutes'), '30');

    await fireEvent.press(view.getByText('Add task'));
    await fireEvent.press(view.getByText('Yes — Add task'));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    // The typed values reach the body, with the number sent as a number.
    expect(post.mock.calls[0][1].action.body).toEqual({ title: 'Ring the vet', duration: 30 });
  });

  test('a form pre-fills what the assistant already worked out', async () => {
    const block = {
      id: 'b0',
      kind: 'form',
      fields: [{ id: 'f0', name: 'title', label: 'Task', type: 'text', required: true, value: 'Ring the vet' }],
      submit: {
        id: 'b0.a0', kind: 'call', label: 'Add', style: 'primary',
        method: 'POST', path: '/api/tasks/single', confirm: true,
      },
    };
    const view = await renderBlocks([block]);
    expect(view.getByLabelText('Task').props.value).toBe('Ring the vet');
    // Pre-filled counts as filled — no "fill this in" nag for a ready form.
    expect(view.queryByText(/^Fill in:/)).toBeNull();
  });

  test('ticking a checklist row runs its action', async () => {
    const post = jest.fn(() => Promise.resolve({ success: true }));
    const block = {
      id: 'b0',
      kind: 'checklist',
      title: 'Still open',
      items: [{
        id: 'b0.i0',
        label: 'Ring the vet',
        checked: false,
        action: {
          id: 'b0.i0.a0', kind: 'call', label: 'Mark done', style: 'default',
          method: 'PATCH', path: '/api/tasks/t-1', body: { completed: true },
          risk: 'write', signature: 'PATCH /api/tasks/:id', confirm: false,
        },
      }],
    };
    const view = await renderBlocks([block], { api: apiOf(post) });

    await fireEvent.press(view.getByLabelText('Ring the vet'));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][1].action.body).toEqual({ completed: true });
  });

  test('a failed tick un-ticks the box rather than lying about it', async () => {
    const post = jest.fn(() => Promise.resolve({ success: false, error: 'Not yours to edit' }));
    const block = {
      id: 'b0',
      kind: 'checklist',
      items: [{
        id: 'b0.i0',
        label: 'Ring the vet',
        checked: false,
        action: {
          id: 'b0.i0.a0', kind: 'call', label: 'Mark done', style: 'default',
          method: 'PATCH', path: '/api/tasks/t-1', risk: 'write', confirm: false,
        },
      }],
    };
    const view = await renderBlocks([block], { api: apiOf(post) });

    const row = view.getByLabelText('Ring the vet');
    await fireEvent.press(row);

    await waitFor(() => expect(view.getByText('Not yours to edit')).toBeTruthy());
    expect(view.getByLabelText('Ring the vet').props.accessibilityState.checked).toBe(false);
  });

  test('a checklist row that changes data still asks before it ticks', async () => {
    const post = jest.fn(() => Promise.resolve({ success: true }));
    const block = {
      id: 'b0',
      kind: 'checklist',
      items: [{
        id: 'b0.i0',
        label: 'Delete the old album',
        checked: false,
        action: {
          id: 'b0.i0.a0', kind: 'call', label: 'Delete it', style: 'danger',
          method: 'DELETE', path: '/api/media/9', risk: 'destructive',
          signature: 'DELETE /api/media/:id', confirm: true, effect: 'DELETE /api/media/:id',
        },
      }],
    };
    const view = await renderBlocks([block], { api: apiOf(post) });

    await fireEvent.press(view.getByLabelText('Delete the old album'));

    expect(post).not.toHaveBeenCalled();
    expect(view.getByText('Yes — Delete it')).toBeTruthy();
  });

  test('a kind from a newer server renders as nothing, not as a guess', async () => {
    const view = await renderBlocks([
      { id: 'b0', kind: 'timeline', items: [{ id: 'x', label: 'nope' }] },
      { id: 'b1', kind: 'note', title: 'Heads up', body: 'Two tasks slipped.' },
    ]);
    expect(view.queryByText('nope')).toBeNull();
    expect(view.getByText('Two tasks slipped.')).toBeTruthy();
  });

  test('an empty board renders nothing at all', async () => {
    const view = await renderBlocks([]);
    expect(view.toJSON()).toBeNull();
  });

  test('stats and list blocks show their content', async () => {
    const view = await renderBlocks([
      { id: 'b0', kind: 'stats', title: 'Vault', items: [{ id: 'b0.i0', label: 'Photos', value: '12,481', hint: 'since 2019' }] },
      {
        id: 'b1',
        kind: 'list',
        items: [{ id: 'b1.i0', title: 'IMG_0421.jpg', subtitle: '4.2 MB', badge: 'read' }],
      },
    ]);
    expect(view.getByText('12,481')).toBeTruthy();
    expect(view.getByText('since 2019')).toBeTruthy();
    expect(view.getByText('IMG_0421.jpg')).toBeTruthy();
    expect(view.getByText('read')).toBeTruthy();
  });
});

describe('board footprint', () => {
  /**
   * Regression: the board took a definite width, not a cap.
   *
   * With `maxWidth: '92%'` and alignSelf flex-start the board shrink-wrapped,
   * so its real width came from what its content reported it needed. A
   * checklist reports almost nothing — its labels are `flex: 1, minWidth: 0`,
   * an intrinsic width of zero — so the board collapsed to the widest thing
   * that DID have one, the card title, and every task label wrapped to a few
   * characters a line. Asserted on the style rather than on measured layout
   * because jest has no layout engine: the bug was the declaration.
   */
  const flatten = (style) => (Array.isArray(style) ? Object.assign({}, ...style.flat(Infinity)) : style);

  it('declares a definite width so content measurement cannot shrink it', async () => {
    const board = {
      id: 'b0',
      kind: 'checklist',
      title: 'Open tasks',
      items: [{ id: 'b0.i0', label: 'The Ontario Building Code review for the Guelph site' }],
    };
    const { toJSON } = await render(
      <ChatBlocks blocks={[board]} theme={theme} api={apiOf()} />,
    );
    const style = flatten(toJSON().props.style);
    expect(style.width).toBe('92%');
    // The cap alone was the bug — a board that only caps still shrink-wraps.
    expect(style.maxWidth).toBeUndefined();
  });
});
