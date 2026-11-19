/**
 * keyboardEvents — a screen hears the keyboard only while it is the focused
 * one. Every tab stays mounted, so without this the keyboard opening in the
 * chat re-rendered Tasks, the calendar, the Notes editor and Profile, mid-ride.
 */
import React from 'react';
import { Keyboard, Text } from 'react-native';
import { render, act } from '@testing-library/react-native';
import { NavigationContext } from '@react-navigation/native';

import { useKeyboardEvents } from '../keyboardEvents';
import useKeyboardHeight from '../useKeyboardHeight';

let listeners;
let metrics;

beforeEach(() => {
  listeners = {};
  metrics = undefined;
  jest.spyOn(Keyboard, 'addListener').mockImplementation((name, fn) => {
    listeners[name] = fn;
    return { remove: () => { if (listeners[name] === fn) delete listeners[name]; } };
  });
  Keyboard.metrics = jest.fn(() => metrics);
});

afterEach(() => { jest.restoreAllMocks(); });

const open = (height = 336) => listeners.keyboardWillShow && listeners.keyboardWillShow({ endCoordinates: { height }, duration: 250 });
const close = () => listeners.keyboardWillHide && listeners.keyboardWillHide({ duration: 250 });

function makeNav(focused = true) {
  const nav = {
    focused,
    onFocus: null,
    isFocused: () => nav.focused,
    addListener: jest.fn((name, fn) => {
      if (name === 'focus') nav.onFocus = fn;
      return () => { nav.onFocus = null; };
    }),
  };
  return nav;
}

function Probe({ onShow, onHide, enabled }) {
  useKeyboardEvents(onShow, onHide, enabled);
  return <Text>probe</Text>;
}

const inNav = (nav, child) => <NavigationContext.Provider value={nav}>{child}</NavigationContext.Provider>;

describe('useKeyboardEvents', () => {
  test('the focused screen hears the keyboard come up and go down', async () => {
    const onShow = jest.fn();
    const onHide = jest.fn();
    await render(inNav(makeNav(true), <Probe onShow={onShow} onHide={onHide} />));
    open(300);
    expect(onShow).toHaveBeenCalledTimes(1);
    expect(onShow.mock.calls[0][0].endCoordinates.height).toBe(300);
    close();
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  test('a screen that is NOT focused hears nothing — neither up nor down', async () => {
    const onShow = jest.fn();
    const onHide = jest.fn();
    await render(inNav(makeNav(false), <Probe onShow={onShow} onHide={onHide} />));
    open();
    close();
    expect(onShow).not.toHaveBeenCalled();
    expect(onHide).not.toHaveBeenCalled();
  });

  test('focus is ASKED at the event, not subscribed to — a tab change re-renders nothing', async () => {
    const nav = makeNav(false);
    const onShow = jest.fn();
    let renders = 0;
    function Counted() {
      renders += 1;
      useKeyboardEvents(onShow, () => {});
      return <Text>counted</Text>;
    }
    await render(inNav(nav, <Counted />));
    const before = renders;
    nav.focused = true;
    expect(renders).toBe(before);
    open();
    expect(onShow).toHaveBeenCalledTimes(1);
  });

  test('a screen that comes into focus with the keyboard already up is told', async () => {
    const nav = makeNav(false);
    const onShow = jest.fn();
    const onHide = jest.fn();
    await render(inNav(nav, <Probe onShow={onShow} onHide={onHide} />));
    open(291); // unfocused: not heard
    expect(onShow).not.toHaveBeenCalled();
    metrics = { height: 291, screenX: 0, screenY: 500, width: 390 };
    nav.focused = true;
    nav.onFocus();
    expect(onShow).toHaveBeenCalledTimes(1);
    expect(onShow.mock.calls[0][0].endCoordinates.height).toBe(291);
    // …and, having been told it is up, it is told when it goes down.
    close();
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  test('outside a navigator there is nothing to be unfocused in', async () => {
    const onShow = jest.fn();
    await render(<Probe onShow={onShow} onHide={() => {}} />);
    open();
    expect(onShow).toHaveBeenCalledTimes(1);
  });

  test('switched off, it does not listen at all', async () => {
    await render(<Probe onShow={() => {}} onHide={() => {}} enabled={false} />);
    expect(Keyboard.addListener).not.toHaveBeenCalled();
  });
});

describe('useKeyboardHeight', () => {
  function Height({ enabled, onRender }) {
    const height = useKeyboardHeight(enabled);
    onRender(height);
    return <Text>{String(height)}</Text>;
  }

  test('the focused screen gets the height, and zero when the keyboard goes', async () => {
    const seen = [];
    await render(inNav(makeNav(true), <Height onRender={(h) => seen.push(h)} />));
    await act(async () => { open(320); });
    expect(seen[seen.length - 1]).toBe(320);
    await act(async () => { close(); });
    expect(seen[seen.length - 1]).toBe(0);
  });

  test('an unfocused screen does not re-render when the keyboard moves', async () => {
    const seen = [];
    await render(inNav(makeNav(false), <Height onRender={(h) => seen.push(h)} />));
    const before = seen.length;
    await act(async () => { open(320); });
    await act(async () => { close(); });
    expect(seen.length).toBe(before);
    expect(seen[seen.length - 1]).toBe(0);
  });

  test('a hidden overlay (enabled false) does not listen', async () => {
    const seen = [];
    await render(<Height enabled={false} onRender={(h) => seen.push(h)} />);
    expect(Keyboard.addListener).not.toHaveBeenCalled();
    expect(seen[seen.length - 1]).toBe(0);
  });
});
