/**
 * DocumentPeek — long-press a file, see what it actually is.
 *
 * The row gives you a 44pt tile, which for a PDF cover or a rendered text page
 * is enough to tell a document from a placeholder and nothing more. This is the
 * same picture at a size you can read a heading off, without committing to
 * opening it — the peek half of iOS's peek-and-pop, over the folder you were
 * already looking at.
 *
 * It is also where SELECT now lives for a long-press. Long-press used to go
 * straight into select mode; that is one tap further away now, which is the
 * trade for the gesture doing the thing you reach for far more often.
 */
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tapHaptic } from '../../../../utils/haptics';
import { documentIcon, formatSize } from './filesUtils';

const when = (ms) => {
  const d = new Date(Number(ms || 0));
  return Number.isNaN(d.getTime()) || !ms ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

function Action({ icon, label, onPress, theme, primary }) {
  const c = theme.colors;
  const tint = primary ? (c.accentInfo || c.primary) : c.textPrimary;
  return (
    <Pressable
      onPress={onPress}
      onPressIn={tapHaptic}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.action, { opacity: pressed ? 0.6 : 1 }]}
      testID={`peek-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`}
    >
      <Icon name={icon} size={22} color={tint} />
      <Text style={[styles.actionText, { color: tint, fontWeight: primary ? '700' : '600' }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

export default function DocumentPeek({ visible, item, thumbUri, onClose, onOpen, onSelect, onShare, theme }) {
  const c = theme.colors;
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  if (!visible || !item) return null;

  const name = item.originalName || item.filename || 'Untitled';
  const meta = [formatSize(item.size), when(item.originalDate ?? item.uploadDate)].filter(Boolean).join(' · ');
  // Tall enough to read a page off, short enough that the actions stay on
  // screen on the smallest phone we support.
  const cardW = Math.min(width - 48, 420);
  const previewH = Math.min(cardW * Math.SQRT2, height - insets.top - insets.bottom - 260);

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close preview" testID="peek-scrim">
        {/* The card swallows its own presses so tapping the picture doesn't
            dismiss the thing you long-pressed to look at. */}
        <Pressable onPress={() => {}} style={[styles.card, { width: cardW, backgroundColor: c.surfaceElevated || c.surface, borderColor: c.border }]}>
          <View style={[styles.preview, { height: previewH, backgroundColor: c.surface }]}>
            {thumbUri ? (
              <Image
                source={{ uri: thumbUri }}
                style={StyleSheet.absoluteFill}
                // contentFit cover + top alignment matches how the server
                // crops a document cover (position: 'top'), so the peek shows
                // the same part of the page the tile promised.
                contentFit="cover"
                contentPosition="top center"
                transition={120}
                testID="peek-image"
              />
            ) : (
              <View style={styles.noPreview} testID="peek-no-preview">
                <Icon name={documentIcon(item)} size={64} color={c.textMuted} />
                <Text style={[styles.noPreviewText, { color: c.textMuted }]} numberOfLines={2}>
                  No preview for this kind of file
                </Text>
              </View>
            )}
          </View>
          <View style={styles.info}>
            <Text style={[styles.name, { color: c.textPrimary }]} numberOfLines={2}>{name}</Text>
            {!!meta && <Text style={[styles.meta, { color: c.textMuted }]} numberOfLines={1}>{meta}</Text>}
          </View>
          <View style={[styles.actions, { borderTopColor: c.border }]}>
            <Action icon="open-in-app" label="Open" onPress={onOpen} theme={theme} primary />
            <Action icon="checkbox-multiple-marked-circle-outline" label="Select" onPress={onSelect} theme={theme} />
            <Action icon="export-variant" label="Share" onPress={onShare} theme={theme} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 24 },
  card: { borderRadius: 18, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  preview: { width: '100%' },
  noPreview: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 24 },
  noPreviewText: { fontSize: 13, textAlign: 'center', flexShrink: 1 },
  info: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10 },
  name: { fontSize: 15, fontWeight: '700', flexShrink: 1 },
  meta: { fontSize: 12.5, marginTop: 3, flexShrink: 1 },
  actions: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  action: { flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 6 },
  actionText: { fontSize: 12, flexShrink: 1 },
});
