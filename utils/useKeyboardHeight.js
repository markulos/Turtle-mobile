/**
 * useKeyboardHeight — the live keyboard height as plain React state.
 *
 * The house keyboard rule (docs/STYLE-RULES.md, "keyboard cover"): a surface
 * reacts to the keyboard by PADDING its scrollable body so content can scroll
 * clear, and by lifting only what the keyboard actually covers. It never wraps
 * itself in a KeyboardAvoidingView (a layout prop animated from JS, a beat
 * behind the keyboard) and never fires a global LayoutAnimation on the event
 * (which captures every unrelated layout change in flight — the "overlay lags
 * behind" symptom).
 *
 * iOS reports `keyboardWillShow` with the final frame before the keyboard
 * moves, so padding set here lands before the first keyboard frame. Android
 * only has the Did events.
 *
 * THIS IS STATE, SO IT IS A RE-RENDER. Whatever calls it re-renders when the
 * keyboard moves, and a whole screen committing on the main thread a few
 * frames into the keyboard's trip stalls whatever is riding it. So it listens
 * as little as it can:
 *
 *   • `enabled` false means NOT LISTENING. An overlay that is mounted but
 *     hidden passes its `visible`; a screen that sits behind a page which
 *     rides the keyboard passes false while that page is up.
 *   • On a tab that is not the focused one it hears nothing at all (see
 *     utils/keyboardEvents) — every tab stays mounted, and the keyboard
 *     opening in the chat is no business of the Profile screen's.
 */
import { useCallback, useEffect, useState } from 'react';
import { useKeyboardEvents } from './keyboardEvents';

export default function useKeyboardHeight(enabled = true) {
  const [height, setHeight] = useState(0);
  const onShow = useCallback((e) => setHeight(e?.endCoordinates?.height || 0), []);
  const onHide = useCallback(() => setHeight(0), []);
  useKeyboardEvents(onShow, onHide, enabled);
  useEffect(() => {
    if (!enabled) setHeight(0);
  }, [enabled]);
  return height;
}
