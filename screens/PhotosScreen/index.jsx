import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import MediaGallery from '../TurtleScreen/components/MediaGallery';

/**
 * PhotosScreen - Dedicated screen for the Photo Vault
 * Accessible from bottom tab navigator
 */
export default function PhotosScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <MediaGallery />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
