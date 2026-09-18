/**
 * The Files tab's sheets, all on the house two-detent ViewerSheet (opens at
 * 60 %, drag up → full screen, header = grab bar, Done = the sheet's own
 * commit). Fields sit in the top bar so the keyboard never covers them.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ViewerSheet from '../PhotoViewer/ViewerSheet';
import AppTextInput from '../../../../components/AppTextInput';
import { tapHaptic, impactHaptic } from '../../../../utils/haptics';
import useFolderData from './useFolderData';
import FolderDisc from './FolderDisc';

/** The sheet pill field: fixed-height View, auto-height input (STYLE-RULES).
 *  AppTextInput draws the placeholder in the app face (STYLE-RULES §5). */
function PillField({ value, onChangeText, placeholder, label, autoFocus, theme, onSubmitEditing }) {
  const c = theme.colors;
  return (
    <View style={[styles.pill, { backgroundColor: c.surface, borderColor: c.border }]}>
      <AppTextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.textMuted}
        autoFocus={autoFocus}
        autoCapitalize="sentences"
        autoCorrect={false}
        returnKeyType="done"
        onSubmitEditing={onSubmitEditing}
        accessibilityLabel={label}
        style={[styles.pillInput, { color: c.textPrimary }]}
      />
    </View>
  );
}

export function FolderNameSheet({ initial = '', title, doneLabel = 'Save', onSubmit, onClose, error, theme, bottomInset = 0 }) {
  const [name, setName] = useState(initial);
  const submit = useCallback(() => { const clean = name.trim().replace(/\s+/g, ' '); if (clean) onSubmit(clean); }, [name, onSubmit]);
  return (
    <ViewerSheet
      title={title}
      doneLabel={doneLabel}
      onDone={submit}
      onClose={onClose}
      keyboard
      theme={theme}
      bottomInset={bottomInset}
      topBar={<PillField value={name} onChangeText={setName} placeholder="Folder name" label="Folder name" autoFocus theme={theme} onSubmitEditing={submit} />}
      testID="folder-name-sheet"
    >
      {!!error && <Text style={[styles.error, { color: theme.colors.accentError || '#e5484d' }]}>{error}</Text>}
      <Text style={[styles.hint, { color: theme.colors.textMuted }]}>Up to 120 characters. No slashes.</Text>
    </ViewerSheet>
  );
}

/** Browse the tree from the root; Done picks the folder you are looking at. */
export function FolderPickerSheet({ title = 'Move to', exclude = [], allowUnfiled = true, onPick, onClose, theme, bottomInset = 0, base = '' }) {
  const [parent, setParent] = useState('root');
  const { data } = useFolderData(parent);
  const c = theme.colors;
  const excluded = useMemo(() => new Set(exclude), [exclude]);
  const here = data?.folder || null;
  const crumbs = data?.path || [];
  const upLabel = crumbs.length > 1 ? crumbs[crumbs.length - 2].name : 'Files';
  return (
    <ViewerSheet
      title={title}
      subtitle={here ? crumbs.map((x) => x.name).join(' › ') : 'Files'}
      doneLabel={here ? 'Move here' : 'Close'}
      onDone={here ? () => onPick({ id: here.id, name: here.name }) : onClose}
      onClose={onClose}
      theme={theme}
      bottomInset={bottomInset}
      topBar={here ? (
        <Pressable onPressIn={() => tapHaptic()} onPress={() => setParent(crumbs.length > 1 ? crumbs[crumbs.length - 2].id : 'root')} accessibilityRole="button" accessibilityLabel={`Back to ${upLabel}`} style={({ pressed }) => [styles.backRow, { opacity: pressed ? 0.6 : 1 }]} hitSlop={8}>
          <Icon name="chevron-left" size={22} color={c.primary} />
          <Text style={[styles.backText, { color: c.primary }]} numberOfLines={1}>{upLabel}</Text>
        </Pressable>
      ) : null}
      testID="folder-picker-sheet"
    >
      <View style={styles.grid}>
        {!here && allowUnfiled && (
          <Pressable onPressIn={() => tapHaptic()} onPress={() => onPick({ id: 'unfiled', name: 'Unfiled' })} accessibilityRole="button" accessibilityLabel="Choose Unfiled" style={({ pressed }) => [styles.unfiled, { opacity: pressed ? 0.6 : 1 }]}>
            <View style={[styles.unfiledDisc, { backgroundColor: c.surface, borderColor: c.border }]}><Icon name="file-outline" size={26} color={c.textSecondary} /></View>
            <Text style={[styles.discName, { color: c.textPrimary }]} numberOfLines={1}>Unfiled</Text>
            <Text style={[styles.discCount, { color: c.textMuted }]} numberOfLines={1}>{data?.unfiled?.count ?? ''}</Text>
          </Pressable>
        )}
        {(data?.folders || []).map((f) => (
          <FolderDisc key={f.id} name={f.name} covers={f.covers} count={f.itemCount} base={base} theme={theme} pending={excluded.has(f.id) || !!f.pending} onPress={() => setParent(f.id)} testID={`pick-${f.id}`} />
        ))}
      </View>
      {data && data.folders.length === 0 && here && <Text style={[styles.hint, { color: c.textMuted }]}>No folders inside. "Move here" files the selection in {here.name}.</Text>}
    </ViewerSheet>
  );
}

const SORTS = [['name', 'Name'], ['date', 'Date'], ['size', 'Size'], ['type', 'Type']];
export function FilesSortSheet({ sort, order, query, onChange, onClose, theme, bottomInset = 0 }) {
  const c = theme.colors;
  const emit = (patch) => onChange({ sort, order, query, ...patch });
  const chip = (active) => [styles.chip, { backgroundColor: active ? c.primary : 'transparent', borderColor: active ? c.primary : c.border }];
  const chipText = (active) => [styles.chipText, { color: active ? c.background : c.textPrimary }];
  const descLabel = sort === 'name' ? 'Z → A' : sort === 'size' ? 'Largest first' : 'Newest first';
  const ascLabel = sort === 'name' ? 'A → Z' : sort === 'size' ? 'Smallest first' : 'Oldest first';
  return (
    <ViewerSheet
      title="Sort & search"
      onClose={onClose}
      keyboard
      theme={theme}
      bottomInset={bottomInset}
      topBar={<PillField value={query} onChangeText={(q) => emit({ query: q })} placeholder="Search this folder" label="Search this folder" theme={theme} />}
      testID="files-sort-sheet"
    >
      <Text style={[styles.label, { color: c.textMuted }]}>SORT BY</Text>
      <View style={styles.chips}>
        {SORTS.map(([k, label]) => (
          <Pressable key={k} onPressIn={() => tapHaptic()} onPress={() => emit({ sort: k })} accessibilityRole="button" accessibilityLabel={`Sort by ${label.toLowerCase()}`} accessibilityState={{ selected: sort === k }} style={({ pressed }) => [...chip(sort === k), { opacity: pressed ? 0.6 : 1 }]} hitSlop={4}>
            <Text style={chipText(sort === k)} numberOfLines={1}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={[styles.label, { color: c.textMuted }]}>ORDER</Text>
      <View style={styles.chips}>
        <Pressable onPressIn={() => tapHaptic()} onPress={() => emit({ order: 'desc' })} accessibilityRole="button" accessibilityLabel="Newest first" accessibilityState={{ selected: order === 'desc' }} style={({ pressed }) => [...chip(order === 'desc'), { opacity: pressed ? 0.6 : 1 }]} hitSlop={4}><Text style={chipText(order === 'desc')} numberOfLines={1}>{descLabel}</Text></Pressable>
        <Pressable onPressIn={() => tapHaptic()} onPress={() => emit({ order: 'asc' })} accessibilityRole="button" accessibilityLabel="Oldest first" accessibilityState={{ selected: order === 'asc' }} style={({ pressed }) => [...chip(order === 'asc'), { opacity: pressed ? 0.6 : 1 }]} hitSlop={4}><Text style={chipText(order === 'asc')} numberOfLines={1}>{ascLabel}</Text></Pressable>
      </View>
    </ViewerSheet>
  );
}

export function FolderActionsSheet({ folder, onRename, onMove, onDelete, onClose, theme, bottomInset = 0 }) {
  const c = theme.colors;
  const danger = c.accentError || '#e5484d';
  const row = (icon, label, onPress, isDanger) => (
    <Pressable onPressIn={() => impactHaptic('light')} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.action, { borderBottomColor: c.border, opacity: pressed ? 0.6 : 1 }]}>
      <Icon name={icon} size={22} color={isDanger ? danger : c.textPrimary} />
      <Text style={[styles.actionText, { color: isDanger ? danger : c.textPrimary }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
  return (
    <ViewerSheet title={folder?.name || 'Folder'} onClose={onClose} theme={theme} bottomInset={bottomInset} collapsedRatio={0.34} testID="folder-actions-sheet">
      {row('pencil-outline', 'Rename folder', onRename)}
      {row('folder-move-outline', 'Move folder', onMove)}
      {row('trash-can-outline', 'Delete folder', onDelete, true)}
    </ViewerSheet>
  );
}

const styles = StyleSheet.create({
  pill: { height: 40, justifyContent: 'center', borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, marginHorizontal: 16, marginBottom: 8 },
  pillInput: { paddingVertical: 0, includeFontPadding: false, fontSize: 15 },
  error: { fontSize: 13, marginHorizontal: 16, marginTop: 4 },
  hint: { fontSize: 12, marginHorizontal: 16, marginTop: 8 },
  backRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: 8, marginHorizontal: 8 },
  backText: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8 },
  unfiled: { alignItems: 'center', width: 88, paddingVertical: 6 },
  unfiledDisc: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  discName: { marginTop: 6, fontSize: 12.5, fontWeight: '600', flexShrink: 1 },
  discCount: { fontSize: 11, marginTop: 1, flexShrink: 1 },
  label: { fontSize: 10.5, letterSpacing: 0.9, fontWeight: '700', marginHorizontal: 16, marginTop: 14, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 },
  chip: { minHeight: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 1, maxWidth: '100%' },
  chipText: { fontSize: 13, fontWeight: '600' },
  action: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 52, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  actionText: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
});
