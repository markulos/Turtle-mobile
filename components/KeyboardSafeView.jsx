import React from 'react';
import {
  View,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Dimensions,
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
