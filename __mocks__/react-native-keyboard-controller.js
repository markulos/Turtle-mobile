/**
 * Jest stand-in for react-native-keyboard-controller.
 *
 * Picked up automatically for every suite (a root `__mocks__` file for a node
 * module needs no `jest.mock` call). The real package is a native module: it
 * has nothing to report in jest, and on a machine without it installed it
 * cannot even be resolved.
 *
 * The keyboard is drivable: `__moveKeyboard(height)` plays one frame to every
 * mounted `useKeyboardHandler`, the way the native side would, and moves the
 * provider's own values with it. `__resetKeyboard()` puts it back down.
 */
const React = require('react');
const { Animated, ScrollView, View } = require('react-native');

const OPEN_HEIGHT = 336;

const reanimated = { height: { value: 0 }, progress: { value: 0 } };
const animated = { height: new Animated.Value(0), progress: new Animated.Value(0) };
const handlers = new Set();

function frame(height, progress) {
  return { height, progress, duration: 250, target: 1 };
}

function __moveKeyboard(height, progress) {
  const p = progress === undefined ? Math.min(height / OPEN_HEIGHT, 1) : progress;
  reanimated.height.value = -height;
  reanimated.progress.value = p;
  animated.height.setValue(-height);
  animated.progress.setValue(p);
  handlers.forEach((h) => {
    if (h.onMove) h.onMove(frame(height, p));
    if (h.onEnd) h.onEnd(frame(height, p));
  });
}

function __resetKeyboard() {
  handlers.clear();
  __moveKeyboard(0, 0);
}

function useKeyboardHandler(handler) {
  React.useEffect(() => {
    handlers.add(handler);
    return () => { handlers.delete(handler); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

const context = { enabled: true, reanimated, animated, layout: { value: null } };

module.exports = {
  __moveKeyboard,
  __resetKeyboard,
  __OPEN_HEIGHT: OPEN_HEIGHT,

  KeyboardProvider: ({ children }) => children,
  useKeyboardContext: () => context,
  useKeyboardAnimation: () => animated,
  useReanimatedKeyboardAnimation: () => reanimated,
  useKeyboardHandler,
  useGenericKeyboardHandler: useKeyboardHandler,
  useResizeMode: () => {},
  useKeyboardController: () => ({ enabled: true, setEnabled: () => {} }),
  useKeyboardState: (selector) => {
    const state = { height: -reanimated.height.value, isVisible: reanimated.height.value !== 0 };
    return selector ? selector(state) : state;
  },
  useReanimatedFocusedInput: () => ({ input: { value: null } }),
  useFocusedInputHandler: () => {},

  KeyboardController: {
    dismiss: () => Promise.resolve(),
    setFocusTo: () => {},
    setInputMode: () => {},
    setDefaultMode: () => {},
    preload: () => {},
    isVisible: () => reanimated.height.value !== 0,
  },
  KeyboardEvents: { addListener: () => ({ remove: () => {} }) },

  KeyboardAvoidingView: View,
  KeyboardStickyView: View,
  KeyboardAwareScrollView: ScrollView,
  KeyboardToolbar: View,
  KeyboardGestureArea: View,
  OverKeyboardView: View,
};
