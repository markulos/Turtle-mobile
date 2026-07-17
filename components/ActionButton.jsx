import React, { useCallback } from 'react';
import { TouchableOpacity } from 'react-native';
import { tapHaptic, impactHaptic, notifyHaptic } from '../utils/haptics';

/**
 * ActionButton — a drop-in replacement for TouchableOpacity that makes an
 * action button feel instantly responsive.
 *
 * Two things every plain TouchableOpacity in this app was missing:
 *   1. A haptic the MOMENT you touch it. We fire on `onPressIn`, not `onPress`,
 *      so the confirmation lands on finger-down (before release, before the
 *      network call) — the button feels like it reacted immediately.
 *   2. A consistent, slightly snappier press dim. RN's default activeOpacity is
 *      0.2 (a heavy flash); the app's hand-tuned buttons use ~0.7, so that's the
 *      default here.
 *
 * It accepts every TouchableOpacity prop and forwards them, so swapping
 * `<TouchableOpacity .../>` → `<ActionButton .../>` is safe with no other edits.
 *
 * Props added on top of TouchableOpacity:
 *   haptic: 'selection' | 'light' | 'medium' | 'heavy' |
 *           'success' | 'warning' | 'error' | 'none'   (default 'selection')
 *     Pick the weight to match the action — 'selection' for taps/toggles,
 *     'medium' for primary commits (save/send/unlock), 'success' when the press
 *     itself completes something.
 */
export const ActionButton = ({
  haptic = 'selection',
  onPressIn,
  activeOpacity = 0.7,
  disabled,
  children,
  ...rest
}) => {
  const handlePressIn = useCallback(
    (e) => {
      if (!disabled) {
        switch (haptic) {
          case 'none': break;
          case 'light': impactHaptic('light'); break;
          case 'medium': impactHaptic('medium'); break;
          case 'heavy': impactHaptic('heavy'); break;
          case 'success': notifyHaptic('success'); break;
          case 'warning': notifyHaptic('warning'); break;
          case 'error': notifyHaptic('error'); break;
          default: tapHaptic(); // 'selection'
        }
      }
      onPressIn?.(e);
    },
    [haptic, disabled, onPressIn]
  );

  return (
    <TouchableOpacity
      activeOpacity={activeOpacity}
      disabled={disabled}
      onPressIn={handlePressIn}
      {...rest}
    >
      {children}
    </TouchableOpacity>
  );
};

export default ActionButton;
