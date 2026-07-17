import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../context/ThemeContext';
import { tapHaptic } from '../../utils/haptics';
import MediaGallery from '../TurtleScreen/components/MediaGallery';
import MusicVault from '../TurtleScreen/components/MusicVault';

/**
 * MediaVault — the tab entry. Instead of dropping straight into the photo
 * grid, it presents two clear destinations:
 *   • Photos & Video — the existing MediaGallery, scoped to kind=visual so
 *     audio never pollutes the photo timeline.
 *   • Music — a lightweight player over the kind=audio slice (sound files
 *     shared/ghost-downloaded from SoundCloud etc.).
 * Non-breaking: the gallery is the same component, just reached one tap in.
 */
export default function PhotosScreen() {
  const { theme } = useTheme();
  const c = theme.colors;
  const insets = useSafeAreaInsets();
  const [view, setView] = useState('chooser'); // 'chooser' | 'photos' | 'music'

  if (view === 'photos') {
    return (
      <View style={[styles.container, { backgroundColor: c.background }]}>
        <MediaGallery kind="visual" onClose={() => setView('chooser')} />
      </View>
    );
  }
  if (view === 'music') {
    return (
      <View style={[styles.container, { backgroundColor: c.background }]}>
        <MusicVault onClose={() => setView('chooser')} />
      </View>
    );
  }

  const Card = ({ icon, title, subtitle, tint, onPress }) => (
    <TouchableOpacity
      activeOpacity={0.85}
      onPressIn={() => tapHaptic()}
      onPress={onPress}
      style={[styles.card, { backgroundColor: c.surfaceElevated, borderColor: c.border }]}
    >
      <View style={[styles.cardIcon, { backgroundColor: tint + '22' }]}>
        <Icon name={icon} size={30} color={tint} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.cardTitle, { color: c.textPrimary }]}>{title}</Text>
        <Text style={[styles.cardSub, { color: c.textTertiary }]}>{subtitle}</Text>
      </View>
      <Icon name="chevron-right" size={26} color={c.textTertiary} />
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: c.background, paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: c.textPrimary }]}>
          <Text style={{ fontWeight: '100' }}>Media </Text>
          <Text style={{ fontWeight: '400' }}>Vault</Text>
        </Text>
      </View>
      <View style={styles.cards}>
        <Card
          icon="image-multiple"
          title="Photos & Video"
          subtitle="Your photo vault"
          tint={c.accentInfo}
          onPress={() => { tapHaptic(); setView('photos'); }}
        />
        <Card
          icon="music"
          title="Music"
          subtitle="Sound files & tracks"
          tint={c.accentSuccess || '#4ADE80'}
          onPress={() => { tapHaptic(); setView('music'); }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 8 },
  headerTitle: { fontSize: 30, letterSpacing: -0.5 },
  cards: { paddingHorizontal: 16, paddingTop: 12, gap: 12 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 18,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { fontSize: 17, fontWeight: '700' },
  cardSub: { fontSize: 13, marginTop: 2 },
});
