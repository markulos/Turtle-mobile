import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { avatarGlyph, avatarTint } from '../utils/avatar';

/**
 * AnimalGlyph — a person's animal as a bare mark, at a given size.
 *
 * The emoji-or-icon branch in ONE place. It is needed in four now (this disc,
 * the Profile card, the handle chip, the Profile tab) and a copy of it is a
 * copy of the emoji's vertical-centring fix, which is the part that gets
 * forgotten: an emoji's own box is taller than its ink, so without an explicit
 * lineHeight it rides high in whatever slot it is given.
 *
 * `color` applies to the ICON form only. An emoji carries its own colour and
 * tinting it either does nothing or flattens it, depending on the platform —
 * so a caller that tints (the tab bar does, for active/inactive) gets a
 * full-colour mark when an animal has been chosen. That is the trade: it is
 * the user's actual animal, which is the point of letting them choose one.
 */
export function AnimalGlyph({ id, animal = null, size = 24, color, style, testID }) {
  const { emoji, icon } = avatarGlyph(id, animal);
  if (emoji) {
    return (
      <Text
        style={[styles.glyphEmoji, { fontSize: size, lineHeight: Math.round(size * 1.2) }, style]}
        testID={testID ? `${testID}-emoji` : undefined}
      >
        {emoji}
      </Text>
    );
  }
  if (!icon) return null;
  return (
    <Icon
      name={icon}
      size={size}
      color={color}
      style={style}
      testID={testID ? `${testID}-icon` : undefined}
    />
  );
}

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
  const hasAnimal = !!(emoji || icon);

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
      {hasAnimal ? (
        <AnimalGlyph
          id={id}
          animal={chosen}
          size={glyph}
          color={onLight ? tint : '#FFFFFF'}
          testID={testID}
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
  // Paired with the explicit lineHeight in AnimalGlyph: an emoji's own box is
  // taller than its ink, so without both it sits visibly high in its slot.
  glyphEmoji: { textAlign: 'center' },
});
