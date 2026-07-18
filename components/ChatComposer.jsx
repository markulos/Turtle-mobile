import React from 'react';
import { View, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { blurProps, frostOverlayColor, frostBorderColor } from '../utils/frostedChat';
import { tapHaptic, impactHaptic } from '../utils/haptics';

/**
 * ChatComposer — the app's ONE chat input, shared by the main Turtle chat and
 * every board conversation so they look + feel identical. A reference-style
 * frosted rounded card: an optional top slot (bot toggle / attached image), a
 * big bare input, an optional row of circular action buttons, and a round send
 * button that fills when armed.
 *
 * Presentational + fully controlled — the parent owns the text + send logic, so
 * this component carries none of the main chat's Claude/terminal machinery
 * (those stay opt-in via `topSlot` / `actions`). Boards use the plain form.
 */
export default function ChatComposer({
  theme,
  value,
  onChangeText,
  onSend,
  sending = false,
  disabled = false,
  placeholder = 'Message…',
  inputRef,
  topSlot = null,        // node rendered above the input (bot slot, image thumb)
  actions = null,        // node rendered as the left action cluster
  marginBottom = 0,      // gap down to whatever sits below (nav bar / safe area)
  multiline = true,
  maxLength = 500,
}) {
  const c = theme.colors;
  const armed = !!value && value.trim().length > 0 && !disabled;
  const styles = makeStyles(theme);

  return (
    <View style={[styles.card, { marginBottom }]}>
      {/* Frosted surface (blur + tint) behind the content — the "see-through"
          look shared with the main chat. */}
      <BlurView pointerEvents="none" style={StyleSheet.absoluteFill} {...blurProps(theme)} />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: frostOverlayColor(theme) }]} />

      {topSlot ? <View style={styles.topZone}>{topSlot}</View> : null}

      <TextInput
        ref={inputRef}
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.textMuted}
        multiline={multiline}
        maxLength={maxLength}
        editable={!disabled}
        autoCorrect={false}
      />

      <View style={styles.actions}>
        {actions}
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          style={[styles.sendCircle, armed && styles.sendCircleArmed]}
          onPressIn={() => armed && impactHaptic('medium')}
          onPress={() => { if (armed && !sending) onSend(); }}
          disabled={!armed || sending}
          accessibilityRole="button"
          accessibilityLabel="Send"
        >
          {sending ? (
            <ActivityIndicator size="small" color={armed ? (theme.mode === 'dark' ? '#111' : '#fff') : c.textMuted} />
          ) : (
            <Icon
              name="arrow-up"
              size={17}
              color={armed ? (theme.mode === 'dark' ? '#111111' : '#FFFFFF') : c.textMuted}
            />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// Optional helper so callers get the same circular action buttons as the main
// chat's @ / # buttons.
export function ComposerAction({ theme, icon, onPress, active, accessibilityLabel }) {
  const c = theme.colors;
  return (
    <TouchableOpacity
      style={[styles0.actionCircle, {
        backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.05)',
      }]}
      onPressIn={() => tapHaptic()}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Icon name={icon} size={14} color={active ? (c.accentInfo || '#4ADE80') : c.textPrimary} />
    </TouchableOpacity>
  );
}

const styles0 = StyleSheet.create({
  actionCircle: { width: 29, height: 29, borderRadius: 14.5, alignItems: 'center', justifyContent: 'center' },
});

const makeStyles = (theme) => StyleSheet.create({
  card: {
    marginHorizontal: 10,
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: frostBorderColor(theme),
    paddingTop: 6,
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  topZone: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  input: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 20,
    color: theme.colors.textPrimary,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 4,
    maxHeight: 130,
    backgroundColor: 'transparent',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 12,
  },
  sendCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)',
  },
  sendCircleArmed: {
    backgroundColor: theme.mode === 'dark' ? '#FFFFFF' : '#111111',
  },
});
