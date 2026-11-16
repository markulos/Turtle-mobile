import React from 'react';
import { View, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import AppTextInput from './AppTextInput';
import { BlurView } from 'expo-blur';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { blurProps, frostOverlayColor, frostBorderColor } from '../utils/frostedChat';
import { inkOn } from '../utils/accentColor';
import { tapHaptic, impactHaptic } from '../utils/haptics';

/**
 * The user's highlight colour, which every key in this bar wears.
 *
 * `accent` is what the Settings picker writes; `accentInfo` is the built-in
 * fallback for a theme that predates it. Named once here so the send key, the
 * action keys and their ink can never drift apart.
 */
const accentOf = (theme) => theme?.colors?.accent || theme?.colors?.accentInfo || '#4ADE80';

/**
 * ChatComposer — the app's ONE chat input body, shared by the main Turtle chat
 * AND every board conversation so they look + feel identical. A reference-style
 * frosted rounded card: an optional top slot (bot toggle / attached image), a
 * big bare input, an optional row of circular action buttons, and a round send
 * button that fills when armed.
 *
 * Two shells:
 *   • default — renders its own frosted card (marginHorizontal, rounded,
 *     border, blur+tint). Boards use this.
 *   • bare    — renders ONLY the body (top slot + input + actions), no card /
 *     frost / margin, so it slots INSIDE an existing frosted wrapper. The main
 *     chat uses this (its `inputArea` already carries the frost, autocomplete
 *     dropdown, and keyboard-sync margin — bare mode avoids double-frost and
 *     leaves that delicate layout untouched).
 *
 * Presentational + fully controlled — the parent owns the text + send logic.
 */

/**
 * The composer's character ceiling.
 *
 * This was 500, and 500 is the reason a copied reply "had a character limit on
 * the clipboard". It never did: iOS truncates a PASTE to fit `maxLength`
 * silently, with no warning and no visible edge — so copying a 4,400-character
 * prompt out of a reply and pasting it back to send on landed 500 characters of
 * it and looked like the clipboard had eaten the rest.
 *
 * Nothing wanted that number. `POST /api/turtle/chat` only requires a non-empty
 * string, `chat_logs.content` is TEXT, and the assistant's own replies routinely
 * run past 5,000 characters — the app was refusing to accept what it had just
 * produced. This is a guard against pasting an entire file into the chat, not a
 * message-length policy, so it sits well clear of anything a person would type
 * or quote.
 */
export const COMPOSER_MAX_LENGTH = 8000;

export default function ChatComposer({
  theme,
  value,
  onChangeText,
  onSend,
  sending = false,
  disabled = false,
  placeholder = 'Message…',
  inputRef,
  topSlot = null,        // node above the input (bot slot / image thumb)
  actions = null,        // node: the left action cluster
  marginBottom = 0,      // gap below the card (default shell only)
  bare = false,          // render only the body (no frost card)
  canSend,               // optional override of the armed condition
  inputProps = null,     // extra props spread onto the TextInput
  multiline = true,
  maxLength = COMPOSER_MAX_LENGTH,
}) {
  const c = theme.colors;
  const armed = canSend !== undefined
    ? !!canSend
    : (!!value && value.trim().length > 0 && !disabled);
  const styles = makeStyles(theme);

  const body = (
    <>
      {topSlot ? <View style={styles.topZone}>{topSlot}</View> : null}

      <AppTextInput
        ref={inputRef}
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.textMuted}
        multiline={multiline}
        maxLength={maxLength}
        editable={!disabled}
        // ONE KEYBOARD FOR EVERY COMPOSER. iOS draws the suggestion bar over
        // the keys when a field has autocorrect, spell-check or autofill on,
        // and that bar makes the keyboard taller. It also opens the keyboard
        // at the size it LAST had and only then corrects it for the field in
        // hand. So two composers that disagree about any of these give each
        // other a two-step: the keyboard rises to the previous chat's height,
        // pauses, and moves again — and everything riding it moves twice
        // with it. The main chat set all four; the friend chat set one, and
        // each made the other stutter the next time it opened. They live
        // here now, so a new composer cannot disagree by leaving one out.
        autoCorrect={false}
        spellCheck={false}
        autoComplete="off"
        textContentType="none"
        {...(inputProps || {})}
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
            <ActivityIndicator size="small" color={armed ? inkOn(accentOf(theme)) : c.textMuted} />
          ) : (
            <Icon
              name="arrow-up"
              size={17}
              color={armed ? inkOn(accentOf(theme)) : c.textMuted}
            />
          )}
        </TouchableOpacity>
      </View>
    </>
  );

  if (bare) return body;

  return (
    <View style={[styles.card, { marginBottom }]}>
      {/* Frosted surface (blur + tint) — the "see-through" look shared with the
          main chat's inputArea. */}
      <BlurView pointerEvents="none" style={StyleSheet.absoluteFill} {...blurProps(theme)} />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: frostOverlayColor(theme) }]} />
      {body}
    </View>
  );
}

// Shared circular action button, so callers get the exact @ / # look.
export function ComposerAction({ theme, icon, onPress, active, accessibilityLabel, size = 14 }) {
  const accent = accentOf(theme);
  return (
    <TouchableOpacity
      style={{
        width: 29, height: 29, borderRadius: 14.5, alignItems: 'center', justifyContent: 'center',
        // The highlight colour IS the key. An active one is the full accent; a
        // resting one is the same hue held back, so the row reads as one family
        // rather than as grey buttons with one coloured exception.
        backgroundColor: active ? accent : `${accent}2E`,
      }}
      onPressIn={() => tapHaptic()}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      {/* inkOn, not a fixed white: the accent can be a pale yellow, and white
          on it is unreadable. It picks black or white by contrast ratio. */}
      <Icon name={icon} size={size} color={active ? inkOn(accent) : accent} />
    </TouchableOpacity>
  );
}

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
    // 6, not 10. The session's keys live up here now and they were sitting a
    // long way off the panel's own top edge — Mark asked for "a smaller top
    // margin for them" (2026-11-16). Still enough that the row is not
    // touching the corner radius.
    paddingTop: 6,
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
  // Armed, the send key is the highlight colour itself — see accentOf. The
  // glyph over it comes from inkOn (above), which is why this sets no colour:
  // a fixed white vanishes on a pale accent and a fixed black on a deep one.
  sendCircleArmed: {
    backgroundColor: accentOf(theme),
  },
});
