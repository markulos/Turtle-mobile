import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { avatarAnimal, avatarTint } from '../utils/avatar';

/**
 * AnimalAvatar — one user's identity disc.
 *
 * A tinted circle carrying the animal silhouette their id hashes to (see
 * utils/avatar). Same treatment as the board discs in ConversationsOverlay, so
 * people and boards read as one visual family.
 *
 * `onLight` paints the glyph dark instead of white — needed on the tab bar's
 * white active chip, where a white-on-tint disc would lose its edge.
 */
export default function AnimalAvatar({
  id,
  size = 44,
  onLight = false,
  style,
  // Fall back to a plain initial if an id somehow yields nothing (shouldn't
  // happen, but an avatar is chrome — it must never be the thing that throws).
  fallbackLabel,
}) {
  const animal = avatarAnimal(id);
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
    >
      {animal ? (
        <Icon name={animal} size={glyph} color={onLight ? tint : '#FFFFFF'} />
      ) : (
        <Text style={[styles.initial, { fontSize: glyph, color: onLight ? tint : '#FFFFFF' }]}>
          {String(fallbackLabel || '?').charAt(0).toUpperCase()}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  initial: { fontWeight: '700' },
});
