/**
 * App-wide touch feel — installed once from App.js.
 *
 * Every <TouchableOpacity> that doesn't already set its own onPressIn now fires
 * a light selection HAPTIC the instant a finger lands (the snappiest, most "it
 * reacted" feedback there is — see utils/haptics), and gets a lighter press
 * fade (activeOpacity 0.7 instead of RN's mushy default 0.2) so taps read as
 * crisp rather than laggy. Buttons that already set onPressIn / activeOpacity
 * keep their own — React's defaultProps only fills the gaps, so nothing
 * double-buzzes and no existing behaviour changes.
 *
 * TouchableOpacity is a CLASS component in RN 0.81, so `defaultProps` is the
 * supported, warning-free lever for this (the deprecation only affects function
 * components). One shared module, trivially reversible.
 */
import { TouchableOpacity } from 'react-native';
import { tapHaptic } from './haptics';

let installed = false;

export function installGlobalTouchFeedback() {
  if (installed) return;
  installed = true;
  const prev = TouchableOpacity.defaultProps || {};
  TouchableOpacity.defaultProps = {
    ...prev,
    // Crisper press dim than RN's 0.2 (which reads as a slow, heavy fade).
    activeOpacity: prev.activeOpacity ?? 0.7,
    // Fire the tick on touch-DOWN so the button feels instant. Only applied
    // when a component hasn't wired its own onPressIn.
    onPressIn: prev.onPressIn ?? (() => tapHaptic()),
  };
}
