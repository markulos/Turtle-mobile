/**
 * keyboardEvents — hearing that the keyboard came up or went down, ONLY while
 * it is this screen's keyboard.
 *
 * WHY. Every tab stays mounted (App.js: detachInactiveScreens={false}), and a
 * keyboard listener is global. So a screen that kept the keyboard's height in
 * state — to pad its list — re-rendered every time the keyboard opened
 * ANYWHERE: opening it in the chat re-rendered the Tasks screen, the calendar,
 * the Notes editor and the Profile screen, none of them on screen. Each of
 * those is thousands of lines, and their commits land on the main thread a few
 * frames into the keyboard's trip — which is exactly when the chat is trying
 * to ride it. That is the stutter that no way of FOLLOWING the keyboard fixes.
 *
 * WHAT IT DOES. `onShow` is called only if the screen this is rendered in is
 * the focused one (and `enabled` is true). `onHide` is called only if `onShow`
 * was. Focus is ASKED at the moment of the event (`navigation.isFocused()`),
 * not subscribed to — subscribing would re-render the screen on every tab
 * change, which is the dock lag all over again.
 *
 * Outside a navigator (an app-level overlay, a test) there is nothing to be
 * unfocused in, and it always listens.
 *
 * A screen that comes into focus with the keyboard ALREADY up is told so, so
 * it is not left unpadded.
 */
import { useContext, useEffect, useRef } from 'react';
import { Keyboard, Platform } from 'react-native';
import { NavigationContext } from '@react-navigation/native';

export function useKeyboardEvents(onShow, onHide, enabled = true) {
  const navigation = useContext(NavigationContext);
  const showRef = useRef(onShow);
  const hideRef = useRef(onHide);
  showRef.current = onShow;
  hideRef.current = onHide;

  useEffect(() => {
    if (!enabled) return undefined;
    const ios = Platform.OS === 'ios';
    let told = false;
    const focused = () => (
      !navigation || typeof navigation.isFocused !== 'function' || navigation.isFocused()
    );
    const up = (e) => {
      if (!focused()) return;
      told = true;
      if (showRef.current) showRef.current(e);
    };
    const down = (e) => {
      if (!told) return;
      told = false;
      if (hideRef.current) hideRef.current(e);
    };
    const catchUp = () => {
      if (told || typeof Keyboard.metrics !== 'function') return;
      const metrics = Keyboard.metrics();
      if (metrics && metrics.height > 0) up({ endCoordinates: metrics, duration: 0 });
    };

    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', up);
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', down);
    const offFocus = navigation && typeof navigation.addListener === 'function'
      ? navigation.addListener('focus', catchUp)
      : null;
    catchUp();

    return () => {
      show.remove();
      hide.remove();
      if (typeof offFocus === 'function') offFocus();
    };
  }, [navigation, enabled]);
}
