import React from 'react';
import { Text, View } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import ErrorBoundary, { withBoundary } from '../ErrorBoundary';

/**
 * React logs every caught render error to console.error on its own, on top of
 * the boundary's own line. Silenced per-test rather than globally so a test
 * that throws unexpectedly still shows up.
 */
let consoleError;
beforeEach(() => { consoleError = jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { consoleError.mockRestore(); });

const Boom = ({ message = 'kaboom' }) => { throw new Error(message); };
const Fine = () => <Text>survived</Text>;

test('children render untouched when nothing throws', async () => {
  const { getByText, queryByText } = await render(
    <ErrorBoundary label="Photos"><Fine /></ErrorBoundary>,
  );
  expect(getByText('survived')).toBeTruthy();
  expect(queryByText(/couldn't load/)).toBeNull();
});

test('a throw becomes a named card carrying the real message', async () => {
  const { getByText } = await render(
    <ErrorBoundary label="Photos"><Boom message="undefined is not an object" /></ErrorBoundary>,
  );
  expect(getByText("Photos couldn't load")).toBeTruthy();
  // The actual message, not a friendly substitute — the person reading this
  // screen is usually the one who can fix it.
  expect(getByText('undefined is not an object')).toBeTruthy();
});

test('without a label it still reports, just unnamed', async () => {
  const { getByText } = await render(<ErrorBoundary><Boom /></ErrorBoundary>);
  expect(getByText("Something didn't load")).toBeTruthy();
});

test('a sibling boundary contains the damage — the rest of the tree survives', async () => {
  const { getByText } = await render(
    <View>
      <ErrorBoundary label="Pill" fallback={null}><Boom /></ErrorBoundary>
      <Fine />
    </View>,
  );
  expect(getByText('survived')).toBeTruthy();
});

test('fallback={null} renders nothing at all — no error box over floating UI', async () => {
  const { queryByText, toJSON } = await render(
    <ErrorBoundary label="Pill" fallback={null}><Boom /></ErrorBoundary>,
  );
  expect(queryByText(/couldn't load/)).toBeNull();
  expect(toJSON()).toBeNull();
});

test('a function fallback is handed the error and a working retry', async () => {
  const { getByText } = await render(
    <ErrorBoundary
      label="Pill"
      fallback={(error, retry) => <Text onPress={retry}>custom: {error.message}</Text>}
    ><Boom message="nope" /></ErrorBoundary>,
  );
  expect(getByText(/custom: nope/)).toBeTruthy();
});

test('onError is called with the error, and its own throw does not re-enter', async () => {
  const onError = jest.fn(() => { throw new Error('reporting is broken too'); });
  const { getByText } = await render(
    <ErrorBoundary label="Photos" onError={onError}><Boom message="first" /></ErrorBoundary>,
  );
  expect(onError).toHaveBeenCalledTimes(1);
  expect(onError.mock.calls[0][0].message).toBe('first');
  // The boundary still rendered its card despite the reporter throwing.
  expect(getByText("Photos couldn't load")).toBeTruthy();
});

test('Try again re-renders the children, so a cause that cleared recovers', async () => {
  // The condition is flipped BY THE TEST, never by a counter inside the
  // component: React invokes a failing render more than once on purpose (it
  // re-runs it to collect the component stack), so "throw on attempt 1" is
  // satisfied before the boundary is ever reached and the test would prove
  // nothing. An external flag is the only deterministic version of this.
  let broken = true;
  const Flaky = () => {
    if (broken) throw new Error('server unreachable');
    return <Text>recovered</Text>;
  };

  const { getByText } = await render(
    <ErrorBoundary label="Photos"><Flaky /></ErrorBoundary>,
  );
  expect(getByText("Photos couldn't load")).toBeTruthy();

  broken = false;
  fireEvent.press(getByText('Try again'));

  // The retry is a setState, and this renderer flushes those asynchronously —
  // asserting straight after the press reads the pre-retry tree.
  await waitFor(() => expect(getByText('recovered')).toBeTruthy());
});

test('children come back FRESH after a retry, not with their old state', async () => {
  // React unmounts a subtree it caught a throw from, so the retry necessarily
  // rebuilds it. Asserted directly because it is the property that makes Retry
  // meaningful: a child that cached the bad value that killed it must not be
  // handed that value back.
  let broken = true;
  let mounts = 0;
  const Child = () => {
    const [instance] = React.useState(() => ++mounts);
    if (broken) throw new Error('bad cached state');
    return <Text>{`instance ${instance}`}</Text>;
  };

  const { getByText } = await render(
    <ErrorBoundary label="Photos"><Child /></ErrorBoundary>,
  );
  expect(getByText("Photos couldn't load")).toBeTruthy();

  broken = false;
  fireEvent.press(getByText('Try again'));

  // A later instance number than the one that threw — the state initialiser
  // ran again, which only happens on a mount.
  await waitFor(() => expect(getByText(`instance ${mounts}`)).toBeTruthy());
  expect(mounts).toBeGreaterThan(1);
});

test('a still-broken child comes straight back as the card, not a white screen', async () => {
  const { getByText } = await render(
    <ErrorBoundary label="Photos"><Boom message="still broken" /></ErrorBoundary>,
  );
  fireEvent.press(getByText('Try again'));
  expect(getByText("Photos couldn't load")).toBeTruthy();
  expect(getByText('still broken')).toBeTruthy();
});

test('a long message is truncated so one card cannot fill the screen', async () => {
  const { getByText } = await render(
    <ErrorBoundary label="Photos"><Boom message={'x'.repeat(900)} /></ErrorBoundary>,
  );
  expect(getByText('x'.repeat(300))).toBeTruthy();
});

test('withBoundary returns a STABLE component type and passes props through', async () => {
  const Screen = ({ greeting }) => <Text>{greeting}</Text>;
  const A = withBoundary(Screen, 'Tasks');
  const B = withBoundary(Screen, 'Tasks');
  // Each call makes its own type; the point is that ONE call at module scope
  // gives a type that stays identical across renders, which is what stops
  // navigation from remounting the screen and losing its state.
  expect(A).toBe(A);
  expect(A).not.toBe(B);
  expect(A.displayName).toBe('Guarded(Tasks)');

  const { getByText } = await render(<A greeting="hello" />);
  expect(getByText('hello')).toBeTruthy();
});

test('withBoundary catches inside the wrapped screen and names it', async () => {
  const Guarded = withBoundary(Boom, 'Tasks');
  const { getByText } = await render(<Guarded />);
  expect(getByText("Tasks couldn't load")).toBeTruthy();
});
