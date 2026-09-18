/**
 * FolderDisc — a folder in the boards' visual language: a disc coloured from
 * its name, filled with a collage of the four newest covers in its subtree
 * (0 → tinted initial; 1 full; 2 columns; 3 big-left + two stacked; 4 → 2×2,
 * reading order (TL, TR, BL, BR)), the name and count under it. A cover that
 * fails to load is dropped so the layout degrades 4→3→2→1→initial instead of
 * leaving a hole.
 */
import React, { memo, useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { tapHaptic } from '../../../../utils/haptics';
import { folderColor, folderTint } from './filesUtils';

export const DISC_SIZE = 72;

function FolderDisc({ name, covers = [], count = 0, size = DISC_SIZE, base = '', pending = false, onPress, onLongPress, theme, testID }) {
  const [failed, setFailed] = useState(() => new Set());
  const urls = useMemo(
    () => (covers || []).map((t) => (String(t).startsWith('http') ? String(t) : `${String(base).replace(/\/api$/, '')}${t}`)).filter((u) => !failed.has(u)).slice(0, 4),
    [covers, base, failed],
  );
  const markFailed = useCallback((u) => setFailed((s) => new Set(s).add(u)), []);
  const c = theme.colors;
  const half = size / 2;
  const cell = (u, style, i) => (
    <Image key={u + i} source={{ uri: u }} style={[styles.abs, style]} contentFit="cover" transition={80} onError={() => markFailed(u)} testID={testID ? `${testID}-cover` : undefined} />
  );
  let collage = null;
  if (urls.length === 1) collage = cell(urls[0], { left: 0, top: 0, width: size, height: size }, 0);
  else if (urls.length === 2) collage = [cell(urls[0], { left: 0, top: 0, width: half, height: size }, 0), cell(urls[1], { left: half, top: 0, width: half, height: size }, 1)];
  else if (urls.length === 3) collage = [cell(urls[0], { left: 0, top: 0, width: half, height: size }, 0), cell(urls[1], { left: half, top: 0, width: half, height: half }, 1), cell(urls[2], { left: half, top: half, width: half, height: half }, 2)];
  else if (urls.length >= 4) collage = [cell(urls[0], { left: 0, top: 0, width: half, height: half }, 0), cell(urls[1], { left: half, top: 0, width: half, height: half }, 1), cell(urls[2], { left: 0, top: half, width: half, height: half }, 2), cell(urls[3], { left: half, top: half, width: half, height: half }, 3)];

  return (
    <Pressable
      delayPressIn={0}
      onPressIn={() => { if (!pending) tapHaptic(); }}
      onPress={pending ? undefined : onPress}
      onLongPress={pending ? undefined : onLongPress}
      disabled={pending}
      accessibilityRole="button"
      accessibilityLabel={`Open folder ${name}`}
      accessibilityState={{ disabled: pending }}
      style={({ pressed }) => [styles.wrap, { width: size + 16, opacity: pressed ? 0.6 : pending ? 0.5 : 1 }]}
      testID={testID}
    >
      <View style={[styles.disc, { width: size, height: size, borderRadius: half, backgroundColor: folderTint(name, 0.22), borderColor: c.border }]}>
        {collage || <Text style={[styles.initial, { color: folderColor(name), fontSize: Math.round(size * 0.42) }]}>{String(name || '?').trim().charAt(0).toUpperCase()}</Text>}
      </View>
      <Text style={[styles.name, { color: c.textPrimary }]} numberOfLines={2}>{name}</Text>
      <Text style={[styles.count, { color: c.textMuted }]} numberOfLines={1}>{count}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: 6 },
  disc: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  abs: { position: 'absolute' },
  initial: { fontWeight: '700' },
  name: { marginTop: 6, fontSize: 12.5, fontWeight: '600', textAlign: 'center', flexShrink: 1 },
  count: { fontSize: 11, marginTop: 1, flexShrink: 1 },
});

export default memo(FolderDisc);
