import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import MediaGallery from '../TurtleScreen/components/MediaGallery';

/**
 * MediaVault — the tab entry. Drops straight into the vault: Boards first, with
 * Music as the second page of the same pager.
 *
 * There used to be a chooser here (two cards: "Photos & Video" / "Music") that
 * cost a tap before any content and duplicated a choice the vault's own tab
 * picker already expresses. Music now lives inside MediaGallery, so this screen
 * is a thin host.
 *
 * kind="visual" keeps audio out of the photo timeline; MusicVault queries the
 * audio slice itself.
 */
export default function PhotosScreen() {
  const { theme } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <MediaGallery kind="visual" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
