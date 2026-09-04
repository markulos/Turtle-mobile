import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import ApiProposalCard from '../ApiProposalCard';
import { readProposal } from '../../utils/apiProposal';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

const theme = {
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

const proposalOf = (payload) => readProposal({ type: 'TURTLE_API_CALL', payload });

const WRITE = proposalOf({
  method: 'POST',
  path: '/api/tasks/single',
  body: { title: 'Buy milk', project: 'Home' },
  risk: 'write',
  reason: 'You asked to be reminded.',
});

const DESTRUCTIVE = proposalOf({
  method: 'DELETE', path: '/api/tasks/t-1729', risk: 'destructive',
});

describe('ApiProposalCard', () => {
  test('shows the whole request, not just a tidy sentence', async () => {
    // The summary is built from the same untrusted object as the request, so
    // it is not evidence the request matches it. The method, path and fields
    // are what make the card auditable.
    const view = await render(
      <ApiProposalCard proposal={WRITE} theme={theme} onConfirm={jest.fn()} />,
    );
    expect(view.getByText('Create task')).toBeTruthy();
    expect(view.getByText('You asked to be reminded.')).toBeTruthy();
    expect(view.getByText('POST')).toBeTruthy();
    expect(view.getByText('/api/tasks/single')).toBeTruthy();
    expect(view.getByText('title')).toBeTruthy();
    expect(view.getByText('project')).toBeTruthy();
  });

  test('nothing runs until it is pressed', async () => {
    const onConfirm = jest.fn(() => Promise.resolve('ok'));
    await render(<ApiProposalCard proposal={WRITE} theme={theme} onConfirm={onConfirm} />);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test('confirming runs it once and reports what came back', async () => {
    const onConfirm = jest.fn(() => Promise.resolve('Task created.'));
    const view = await render(
      <ApiProposalCard proposal={WRITE} theme={theme} onConfirm={onConfirm} />,
    );
    await fireEvent.press(view.getByLabelText('Create task — run this now'));

    await waitFor(() => view.getByText('Task created.'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(WRITE);
    // The buttons are gone, so a double tap cannot fire a second write.
    expect(view.queryByText('No')).toBeNull();
  });

  test('a failure shows the server\'s own words, not a generic apology', async () => {
    const onConfirm = jest.fn(() => Promise.reject(new Error('API Error 400: title is required')));
    const view = await render(
      <ApiProposalCard proposal={WRITE} theme={theme} onConfirm={onConfirm} />,
    );
    await fireEvent.press(view.getByLabelText('Create task — run this now'));
    await waitFor(() => view.getByText(/title is required/));
  });

  test('declining runs nothing and says so', async () => {
    const onConfirm = jest.fn();
    const onDismiss = jest.fn();
    const view = await render(
      <ApiProposalCard proposal={WRITE} theme={theme} onConfirm={onConfirm} onDismiss={onDismiss} />,
    );
    await fireEvent.press(view.getByLabelText("Don't do this"));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(view.getByText('Left alone.')).toBeTruthy();
  });

  test('a destructive action names itself on the button', async () => {
    // "Do it" on a delete is the label that gets tapped without reading.
    const view = await render(
      <ApiProposalCard proposal={DESTRUCTIVE} theme={theme} onConfirm={jest.fn()} />,
    );
    // Twice: once as the heading, once as the button — the button is the one
    // that matters, and a generic "Do it" there is what gets tapped unread.
    expect(view.getAllByText('Delete task')).toHaveLength(2);
    expect(view.queryByText('Do it')).toBeNull();
  });

  test('renders nothing at all when there is no proposal', async () => {
    const view = await render(<ApiProposalCard proposal={null} theme={theme} onConfirm={jest.fn()} />);
    expect(view.toJSON()).toBeNull();
  });
});
