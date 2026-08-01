/**
 * DownloadsPill — floating, app-wide status widget for ghost-downloads (links
 * shared into the Download album / enqueued). Mirrors VaultUploadPill: a small
 * chip while collapsed, an expandable card listing active/failed jobs with
 * cancel + retry. Renders nothing when there's nothing in flight. Sits just
 * ABOVE the vault-upload pill so the two never overlap.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';
import { useDownloads } from '../context/DownloadsContext';
import { dockOccupied } from './tabBarLayout';
import { tapHaptic } from '../utils/haptics';

// Same clearance the vault-upload pill keeps over the dock, plus the height of
// that pill so this one stacks above it. Both read dockOccupied rather than a
// hardcoded bar height — the dock is a floating card whose real occupancy is
// card + float gap + safe area, and the old 49pt constant left both pills
// sitting on top of it.
const PILL_GAP = 10;
const VAULT_PILL_STACK = 60;

export default function DownloadsPill() {
  const { theme } = useTheme();
  const { jobs, control, remove } = useDownloads();
  const insets = useSafeAreaInsets();
  const [expanded, setExpanded] = useState(false);

  const c = theme.colors;
  // Only surface actionable jobs — active transfers + failures. Done items are
  // already in Photos, so they drop off the pill.
  const shown = jobs.filter((j) => ['queued', 'downloading', 'ingesting', 'error', 'paused'].includes(j.status));
  if (!shown.length) return null;

  const activeJobs = shown.filter((j) => ['queued', 'downloading', 'ingesting'].includes(j.status));
  const errored = shown.filter((j) => j.status === 'error').length;
  const pausedCount = shown.filter((j) => j.status === 'paused').length;
  const avg = activeJobs.length
    ? Math.round(activeJobs.reduce((a, j) => a + (typeof j.percent === 'number' ? j.percent : 0), 0) / activeJobs.length)
    : 0;
  const bottom = dockOccupied(insets.bottom) + PILL_GAP + VAULT_PILL_STACK; // above the vault-upload pill

  if (!expanded) {
    // Label priority: active progress → failures → paused.
    const chipLabel = activeJobs.length
      ? `${activeJobs.length} · ${avg}%${errored ? ` · ${errored}✕` : ''}`
      : errored ? `${errored} failed` : `${pausedCount} paused`;
    const chipColor = activeJobs.length ? c.primary : errored ? (c.accentError || c.textSecondary) : c.textSecondary;
    const chipIcon = activeJobs.length
      ? <ActivityIndicator size="small" color={c.primary} />
      : errored ? <Icon name="alert-circle-outline" size={15} color={c.accentError || c.textSecondary} />
        : <Icon name="pause" size={15} color={c.textSecondary} />;
    return (
      <View pointerEvents="box-none" style={[styles.container, { bottom, alignItems: 'flex-end' }]}>
        <TouchableOpacity
          onPressIn={() => tapHaptic()}
          onPress={() => setExpanded(true)}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Show downloads"
          style={[styles.chip, { backgroundColor: c.surfaceElevated, borderColor: c.border }]}
        >
          {chipIcon}
          <Icon name="download" size={14} color={chipColor} />
          <Text style={[styles.chipLabel, { color: chipColor }]}>{chipLabel}</Text>
          <Icon name="chevron-up" size={16} color={c.textMuted} />
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View pointerEvents="box-none" style={[styles.container, { bottom }]}>
      <View style={[styles.card, { backgroundColor: c.surfaceElevated, borderColor: c.border }]}>
        <View style={styles.header}>
          <Icon name="download" size={16} color={c.primary} />
          <Text style={[styles.title, { color: c.textPrimary }]}>Downloads</Text>
          <TouchableOpacity onPress={() => { tapHaptic(); setExpanded(false); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Icon name="chevron-down" size={20} color={c.textMuted} />
          </TouchableOpacity>
        </View>
        <ScrollView style={{ maxHeight: 260 }} showsVerticalScrollIndicator={false}>
          {shown.map((j) => {
            const active = ['queued', 'downloading', 'ingesting'].includes(j.status);
            const pct = typeof j.percent === 'number' ? j.percent : (active ? 0 : 0);
            const label = j.filename || j.url;
            return (
              <View key={j.id} style={[styles.row, { borderTopColor: c.border }]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={[styles.rowTitle, { color: c.textPrimary }]}>{label}</Text>
                  <Text numberOfLines={1} style={[styles.rowSub, { color: j.status === 'error' ? (c.accentError || c.textSecondary) : c.textSecondary }]}>
                    {j.status === 'downloading' ? `${pct}%`
                      : j.status === 'ingesting' ? 'Adding to vault…'
                        : j.status === 'queued' ? 'Queued'
                          : j.status === 'paused' ? 'Paused'
                            : j.status === 'error' ? (j.error || 'Failed') : j.status}
                  </Text>
                  {active && (
                    <View style={[styles.bar, { backgroundColor: c.border }]}>
                      <View style={{ height: '100%', width: `${pct}%`, backgroundColor: c.primary, borderRadius: 2 }} />
                    </View>
                  )}
                </View>
                {j.status === 'error'
                  ? <TouchableOpacity onPress={() => { tapHaptic(); control(j.id, 'retry'); }} style={styles.act}><Icon name="refresh" size={18} color={c.primary} /></TouchableOpacity>
                  : j.status === 'paused'
                    ? <TouchableOpacity onPress={() => { tapHaptic(); control(j.id, 'resume'); }} style={styles.act}><Icon name="play" size={18} color={c.primary} /></TouchableOpacity>
                    : null}
                <TouchableOpacity onPress={() => { tapHaptic(); active ? control(j.id, 'cancel') : remove(j.id); }} style={styles.act}>
                  <Icon name={active ? 'close' : 'trash-can-outline'} size={18} color={c.textMuted} />
                </TouchableOpacity>
              </View>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'absolute', left: 12, right: 12, zIndex: 9999 }, // above VaultUploadPill (9998)
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1,
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 5,
  },
  chipLabel: { fontSize: 13, fontWeight: '700' },
  card: {
    borderRadius: 14, borderWidth: 1, padding: 12,
    shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 7,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  title: { flex: 1, fontSize: 14, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth },
  rowTitle: { fontSize: 13, fontWeight: '600' },
  rowSub: { fontSize: 11.5, marginTop: 1 },
  bar: { height: 4, borderRadius: 2, marginTop: 6, overflow: 'hidden' },
  act: { padding: 5 },
});
