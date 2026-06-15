import React from 'react';
import {
  View,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Dimensions,
  Keyboard,
  TouchableWithoutFeedback,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

/**
 * A reusable component that ensures inputs are always visible above the keyboard.
 * Uses different strategies for screens vs modals.
 */

// For full screens
export const KeyboardSafeScreen = ({ 
  children, 
  style, 
  contentContainerStyle,
  enableOnAndroid = true,
  extraScrollHeight = 100,
  ...props 
}) => (
  <KeyboardAwareScrollView
    style={[styles.screen, style]}
    contentContainerStyle={[styles.screenContent, contentContainerStyle]}
    keyboardShouldPersistTaps="handled"
    enableOnAndroid={enableOnAndroid}
    extraScrollHeight={Platform.OS === 'ios' ? 40 : extraScrollHeight}
    enableResetScrollToCoords={false}
    showsVerticalScrollIndicator={false}
    {...props}
  >
    {children}
  </KeyboardAwareScrollView>
);

// For modals (bottom sheet style)
export const KeyboardSafeModal = ({ 
  children, 
  style, 
  contentContainerStyle,
  maxHeight = '90%',
  ...props 
}) => (
  <View style={[styles.modalOverlay, { maxHeight }]}>
    <KeyboardAwareScrollView
      style={[styles.modalScroll, style]}
      contentContainerStyle={[styles.modalContent, contentContainerStyle]}
      keyboardShouldPersistTaps="handled"
      enableOnAndroid={true}
      extraScrollHeight={Platform.OS === 'ios' ? 80 : 120}
      enableResetScrollToCoords={false}
      showsVerticalScrollIndicator={true}
      {...props}
    >
      {children}
    </KeyboardAwareScrollView>
  </View>
);

// For simple forms with few inputs (uses KeyboardAvoidingView)
export const KeyboardSafeForm = ({ 
  children, 
  style,
  behavior = Platform.OS === 'ios' ? 'padding' : 'height',
  keyboardVerticalOffset = 0,
}) => (
  <KeyboardAvoidingView
    style={[styles.form, style]}
    behavior={behavior}
    keyboardVerticalOffset={keyboardVerticalOffset}
  >
    {children}
  </KeyboardAvoidingView>
);

// Wrapper for center-screen modals (like PIN entry)
export const KeyboardSafeCenterModal = ({ 
  children, 
  style,
}) => (
  <KeyboardAvoidingView
    style={[styles.centerModal, style]}
    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    keyboardVerticalOffset={Platform.OS === 'ios' ? 40 : 0}
  >
    {children}
  </KeyboardAvoidingView>
);

/**
 * DismissKeyboardView — tap-outside-to-dismiss wrapper.
 *
 * Wraps its children in a TouchableWithoutFeedback that calls
 * Keyboard.dismiss() on any tap that doesn't hit a child handler.
 * Use as the outermost wrapper of any screen / modal with text inputs
 * but no full-screen scroll (login forms, modal sheets, settings).
 *
 *   accessible={false} keeps the wrapper out of assistive-tech tab
 *   order — it's invisible affordance, not a real button.
 *
 * Pairs with `keyboardScrollProps` (below) for the scroll-list case.
 */
export function DismissKeyboardView({ children, style }) {
  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View style={[{ flex: 1 }, style]}>
        {children}
      </View>
    </TouchableWithoutFeedback>
  );
}

/**
 * Spread these props onto any scrollable container (ScrollView /
 * FlatList / SectionList / FlashList) to enable the iMessage-style
 * "drag down to dismiss keyboard" + "taps on other elements pass
 * through" combo.
 *
 *   keyboardDismissMode:
 *     iOS 'interactive'  — keyboard follows the user's drag finger
 *     Android 'on-drag'  — keyboard hides as soon as the drag begins
 *     (iOS 'interactive' isn't supported on Android — falls back to
 *      'on-drag' there.)
 *
 *   keyboardShouldPersistTaps='handled':
 *     A tap on a child onPress handler runs AND the keyboard dismisses
 *     in one gesture. Without this, the first tap is consumed to
 *     dismiss the keyboard — costing the user a second tap on every
 *     action while typing.
 *
 * Usage:
 *   <FlatList {...keyboardScrollProps} ... />
 */
export const keyboardScrollProps = {
  keyboardDismissMode: Platform.OS === 'ios' ? 'interactive' : 'on-drag',
  keyboardShouldPersistTaps: 'handled',
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  screenContent: {
    flexGrow: 1,
  },
  modalOverlay: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: SCREEN_HEIGHT * 0.9,
    overflow: 'hidden',
  },
  modalScroll: {
    flex: 1,
  },
  modalContent: {
    padding: 20,
    paddingBottom: 40,
  },
  form: {
    flex: 1,
  },
  centerModal: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
