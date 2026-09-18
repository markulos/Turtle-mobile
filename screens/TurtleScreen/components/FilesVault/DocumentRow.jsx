/**
 * DocumentRow — one file in a folder: the PDF cover (or a typed icon), the
 * name on two lines, `size · date`, a selection check in select mode, and a
 * hairline progress bar while it downloads for opening. 44 pt tall targets,
 * every text flexShrinks.
 */
import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { tapHaptic } from '../../../../utils/haptics';
import { documentIcon, formatSize } from './filesUtils';

const when = (ms) => {
  const d = new Date(Number(ms || 0));
  return Number.isNaN(d.getTime()) || !ms ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

function DocumentRow({ item, thumbUri, selected = false, selectMode = false, onPress, onLongPress, progress = null, theme, testID }) {
  const c = theme.colors;
  const name = item.originalName || item.filename || 'Untitled';
  const meta = [formatSize(item.size), when(item.originalDate ?? item.uploadDate)].filter(Boolean).join(' · ');
  return (
    <Pressable
      delayPressIn={0}
      onPressIn={tapHaptic}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={selectMode ? `${selected ? 'Deselect' : 'Select'} ${name}` : `Open ${name}`}
      accessibilityState={{ selected }}
      style={({ pressed }) => [styles.row, { borderBottomColor: c.border, opacity: pressed ? 0.6 : 1 }]}
      testID={testID}
    >
      <View style={[styles.thumb, { backgroundColor: c.surfaceElevated || c.surface }]}>
        {thumbUri
          ? <Image source={{ uri: thumbUri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={80} testID={testID ? `${testID}-cover` : undefined} />
          : <Icon name={documentIcon(item)} size={26} color={c.textSecondary} testID={testID ? `${testID}-icon` : undefined} />}
      </View>
      <View style={styles.text}>
        <Text style={[styles.name, { color: c.textPrimary }]} numberOfLines={2}>{name}</Text>
        {!!meta && <Text style={[styles.meta, { color: c.textMuted }]} numberOfLines={1}>{meta}</Text>}
      </View>
      {selectMode && (
        <Icon name={selected ? 'check-circle' : 'checkbox-blank-circle-outline'} size={22} color={selected ? c.primary : c.textMuted} testID={testID ? `${testID}-check` : undefined} />
      )}
      {progress != null && progress < 1 && (
        <View style={[styles.track, { backgroundColor: c.border }]} pointerEvents="none">
          <View style={[styles.fill, { backgroundColor: c.accentInfo || c.primary, width: `${Math.round(Math.max(0.02, progress) * 100)}%` }]} testID={testID ? `${testID}-progress` : undefined} />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingVertical: 8, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  thumb: { width: 44, height: 44, borderRadius: 8, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0 },
  name: { fontSize: 14.5, fontWeight: '600', flexShrink: 1 },
  meta: { fontSize: 12, marginTop: 2, flexShrink: 1 },
  track: { position: 'absolute', left: 16, right: 16, bottom: 0, height: 2, borderRadius: 1 },
  fill: { height: 2, borderRadius: 1 },
});

export default memo(DocumentRow);
