import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { avatarGlyph, avatarTint } from '../utils/avatar';

/**
 * AnimalAvatar — one user's identity disc.
 *
 * A tinted circle carrying their animal. Same treatment as the board discs in
 * ConversationsOverlay, so people and boards read as one visual family.
 *
 * Two renderings, decided by `utils/avatar`'s `avatarGlyph` rather than here:
 * a CHOSEN animal is a colour emoji, an assigned one is the icon-font
 * silhouette the id hashes to. (The icon font has no raccoon — that file
 * explains why the two differ.)
 *
 * `animal` is the chosen key, and it is a PROP rather than something this
 * component reads from the preference store itself. A disc is drawn for OTHER
 * people far more often than for the signed-in one, and a leaf component that
 * reached for auth state would be wrong for all of those — so the few SELF
 * sites pass `useMyAvatarAnimal()` in explicitly.
 *
 * `onLight` paints the glyph dark instead of white — needed on the tab bar's
 * white active chip, where a white-on-tint disc would lose its edge.
 */
export default function AnimalAvatar({
  id,
  size = 44,
  onLight = false,
  /** The animal this person has chosen, when it is known. */
  animal: chosen = null,
  style,
  // Fall back to a plain initial if an id somehow yields nothing (shouldn't
  // happen, but an avatar is chrome — it must never be the thing that throws).
  fallbackLabel,
  testID,
}) {
  const { emoji, icon } = avatarGlyph(id, chosen);
  const tint = avatarTint(id);
  const glyph = Math.round(size * 0.55);

  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: onLight ? `${tint}33` : tint,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
      testID={testID}
    >
      {emoji ? (
        // No colour is applied: an emoji carries its own, and tinting it would
        // either do nothing or flatten it depending on the platform.
        <Text
          style={[styles.emoji, { fontSize: glyph, lineHeight: Math.round(glyph * 1.2) }]}
          testID={testID ? `${testID}-emoji` : undefined}
        >
          {emoji}
        </Text>
      ) : icon ? (
        <Icon
          name={icon}
          size={glyph}
          color={onLight ? tint : '#FFFFFF'}
          testID={testID ? `${testID}-icon` : undefined}
        />
      ) : (
        <Text
          style={[styles.initial, { fontSize: glyph, color: onLight ? tint : '#FFFFFF' }]}
          testID={testID ? `${testID}-initial` : undefined}
        >
          {String(fallbackLabel || '?').charAt(0).toUpperCase()}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  initial: { fontWeight: '700' },
  // The lineHeight above plus this: an emoji's own box is taller than its ink,
  // so without both it sits visibly high inside the disc.
  emoji: { textAlign: 'center' },
});
