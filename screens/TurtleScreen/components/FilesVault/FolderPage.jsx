/**
 * FolderPage — one level of the Files tree, pushed as an EdgeSwipePage
 * overlay (a subfolder pushes another; the left-edge swipe pops). Header:
 * back chevron, breadcrumb (Files › … › Parent › Name), ⋯. Body: subfolder
 * discs, then documents as rows and media as a three-column thumb grid.
 * Long-press → select mode → Move · Tag · Delete, all optimistic.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import EdgeSwipePage from '../EdgeSwipePage';
import { ActionButton } from '../../../../components/ActionButton';
import { tapHaptic, impactHaptic, notifyHaptic } from '../../../../utils/haptics';
import useFolderData from './useFolderData';
import FolderDisc from './FolderDisc';
import DocumentRow from './DocumentRow';
import { FolderNameSheet, FolderPickerSheet, FilesSortSheet, FolderActionsSheet } from './FolderSheets';
import { openDocument } from './documentOpen';
import { collapseCrumbs, isDocument, sortFolderItems } from './filesUtils';

const GRID_COLS = 3;
const GAP = 2;

export default function FolderPage({ visible, parent, onClose, onOpenFolder, onOpenMedia, onBulkTag, onUploadHere, getFullUrl, base, theme, topInset = 0, bottomInset = 0 }) {
  const c = theme.colors;
  const danger = c.accentError || '#e5484d';
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [sort, setSort] = useState('date');
  const [order, setOrder] = useState('desc');
  const [query, setQuery] = useState('');
  const { data, loading, error, refresh, createFolder, renameFolder, moveFolder, deleteFolder, moveItems, removeItems } = useFolderData(parent, { sort, order });
  const [selected, setSelected] = useState(() => new Set());
  const selectMode = selected.size > 0;
  // null | { kind: 'new'|'rename'|'move-items'|'move-folder'|'sort'|'actions'|'delete-target', folder?, error? }
  const [sheet, setSheet] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [progress, setProgress] = useState({}); // id → 0..1
  const [refreshing, setRefreshing] = useState(false);
  const busyRef = useRef(false);

  const isUnfiled = parent === 'unfiled';
  const folderId = data?.folder?.id || null;
  const crumbs = useMemo(() => collapseCrumbs([{ id: 'root', name: 'Files' }, ...(data?.path || [])], 4), [data]);
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = sortFolderItems(data?.items || [], sort, order);
    return q ? all.filter((i) => String(i.originalName || i.filename || '').toLowerCase().includes(q)) : all;
  }, [data, sort, order, query]);
  const docs = useMemo(() => items.filter(isDocument), [items]);
  const media = useMemo(() => items.filter((i) => !isDocument(i)), [items]);
  const thumbOf = useCallback((i) => (i.thumbnailUrl ? getFullUrl(i.thumbnailUrl) : null), [getFullUrl]);

  const toggle = useCallback((id) => { setMenuOpen(false); setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }, []);
  const clearSelection = useCallback(() => setSelected(new Set()), []);
  const selectedItems = useMemo(() => items.filter((i) => selected.has(i.id)), [items, selected]);

  const open = useCallback(async (item) => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      await openDocument(item, { getFullUrl, onProgress: (p) => setProgress((m) => ({ ...m, [item.id]: p })) });
    } catch (e) {
      notifyHaptic('error');
      Alert.alert('Could not open', e?.message || 'Could not open the file.');
    } finally {
      busyRef.current = false;
      setProgress((m) => { const n = { ...m }; delete n[item.id]; return n; });
    }
  }, [getFullUrl]);

  const fail = useCallback((e) => { notifyHaptic('error'); Alert.alert('Not saved', e?.message || 'Something went wrong.'); }, []);

  const submitName = useCallback(async (name) => {
    try {
      if (sheet?.kind === 'new') await createFolder(name);
      else if (sheet?.kind === 'rename') await renameFolder(sheet.folder.id, name);
      setSheet(null);
      notifyHaptic('success');
    } catch (e) { setSheet((s) => (s ? { ...s, error: e?.message || 'Not saved' } : s)); }
  }, [sheet, createFolder, renameFolder]);

  const pickTarget = useCallback(async (target) => {
    const dest = target.id === 'unfiled' ? null : target.id;
    const current = sheet;
    setSheet(null);
    try {
      if (current?.kind === 'move-items') { const ids = Array.from(selected); clearSelection(); await moveItems(ids, dest); }
      else if (current?.kind === 'move-folder') await moveFolder(current.folder.id, dest);
      else if (current?.kind === 'delete-target') await deleteFolder(current.folder.id, target.id === 'unfiled' ? 'unfiled' : target.id);
      notifyHaptic('success');
    } catch (e) { fail(e); }
  }, [sheet, selected, clearSelection, moveItems, moveFolder, deleteFolder, fail]);

  const askDelete = useCallback((folder) => {
    setSheet(null);
    if (!folder.itemCount && !folder.folderCount) { deleteFolder(folder.id).then(() => notifyHaptic('success')).catch(fail); return; }
    Alert.alert(`Delete ${folder.name}?`, `It holds ${folder.itemCount} item${folder.itemCount === 1 ? '' : 's'} and ${folder.folderCount} folder${folder.folderCount === 1 ? '' : 's'}. Where should they go?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Move contents to…', onPress: () => setSheet({ kind: 'delete-target', folder }) },
    ]);
  }, [deleteFolder, fail]);

  const deleteSelected = useCallback(() => {
    const ids = Array.from(selected);
    Alert.alert(`Delete ${ids.length} item${ids.length === 1 ? '' : 's'}?`, 'This removes them from Turtle.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { clearSelection(); removeItems(ids).then(() => notifyHaptic('success')).catch(fail); } },
    ]);
  }, [selected, clearSelection, removeItems, fail]);

  const cellW = (width - 32 - GAP * (GRID_COLS - 1)) / GRID_COLS;
  const header = (
    <View>
      {!!data?.folders?.length && (
        <View style={styles.discs}>
          {data.folders.map((f) => (
            <FolderDisc key={f.id} name={f.name} covers={f.covers} count={f.itemCount} base={base} theme={theme} pending={!!f.pending}
              onPress={() => onOpenFolder(f)} onLongPress={() => { impactHaptic('medium'); setSheet({ kind: 'actions', folder: f }); }} testID={`disc-${f.id}`} />
          ))}
        </View>
      )}
      {docs.length > 0 && <Text style={[styles.section, { color: c.textMuted }]}>FILES · {docs.length}</Text>}
    </View>
  );
  const footer = (
    <View style={{ paddingBottom: Math.max(insets.bottom, bottomInset) + (selectMode ? 88 : 24) }}>
      {media.length > 0 && <Text style={[styles.section, { color: c.textMuted }]}>PHOTOS & VIDEOS · {media.length}</Text>}
      <View style={styles.grid}>
        {media.map((m) => (
          <Pressable key={m.id} delayPressIn={0} onPressIn={tapHaptic} onPress={() => (selectMode ? toggle(m.id) : onOpenMedia(media, m))} onLongPress={() => { impactHaptic('medium'); toggle(m.id); }}
            accessibilityRole="button" accessibilityLabel={`${selectMode ? (selected.has(m.id) ? 'Deselect' : 'Select') : 'Open'} photo ${m.originalName || m.filename || ''}`}
            style={({ pressed }) => [{ width: cellW, height: cellW, marginRight: GAP, marginBottom: GAP, backgroundColor: c.surface, opacity: pressed ? 0.6 : 1 }]}>
            {thumbOf(m) ? <Image source={{ uri: thumbOf(m) }} style={StyleSheet.absoluteFill} contentFit="cover" transition={80} /> : null}
            {m.type === 'video' && <View style={styles.play}><Icon name="play" size={16} color="#fff" /></View>}
            {selectMode && <View style={styles.check}><Icon name={selected.has(m.id) ? 'check-circle' : 'checkbox-blank-circle-outline'} size={22} color="#fff" /></View>}
          </Pressable>
        ))}
      </View>
      {data && items.length === 0 && !data.folders?.length && (
        <Text style={[styles.empty, { color: c.textMuted }]}>{query ? 'Nothing matches.' : 'Nothing here yet.'}</Text>
      )}
      {!!error && <Text style={[styles.empty, { color: danger }]}>{error}</Text>}
    </View>
  );

  return (
    <EdgeSwipePage overlay visible={visible} onClose={selectMode ? () => { clearSelection(); return true; } : onClose} swipeEnabled={!sheet && !selectMode}>
      <View style={[styles.page, { backgroundColor: c.background, paddingTop: topInset }]}>
        <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
          <Pressable onPress={onClose} onPressIn={tapHaptic} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back" style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.6 : 1 }]}>
            <Icon name="chevron-left" size={28} color={c.textPrimary} />
          </Pressable>
          <View style={styles.crumbs}>
            {crumbs.map((cr, i) => (
              <React.Fragment key={`${cr.id}-${i}`}>
                {i > 0 && <Text style={[styles.crumbSep, { color: c.textMuted }]}>›</Text>}
                <Text style={[i === crumbs.length - 1 ? styles.crumbTail : styles.crumb, { color: i === crumbs.length - 1 ? c.textPrimary : c.textSecondary }]} numberOfLines={1}>{cr.name}</Text>
              </React.Fragment>
            ))}
          </View>
          <Pressable onPress={() => setMenuOpen((v) => !v)} onPressIn={tapHaptic} hitSlop={10} accessibilityRole="button" accessibilityLabel="More actions" style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.6 : 1 }]}>
            <Icon name="dots-horizontal" size={24} color={c.textPrimary} />
          </Pressable>
        </View>
        {menuOpen && (
          <View style={[styles.menu, { top: insets.top + 6 + 44 + 8 + 4, backgroundColor: c.surfaceElevated || c.surface, borderColor: c.border }]}>
            {!isUnfiled && <MenuRow icon="folder-plus-outline" label="New folder" theme={theme} onPress={() => { setMenuOpen(false); setSheet({ kind: 'new' }); }} />}
            {!isUnfiled && <MenuRow icon="tray-arrow-up" label="Upload here" theme={theme} onPress={() => { setMenuOpen(false); onUploadHere(folderId); }} />}
            <MenuRow icon="sort" label="Sort & search" theme={theme} onPress={() => { setMenuOpen(false); setSheet({ kind: 'sort' }); }} />
            {items.length > 0 && <MenuRow icon="checkbox-multiple-marked-circle-outline" label="Select" theme={theme} onPress={() => { setMenuOpen(false); setSelected(new Set([items[0].id])); }} />}
          </View>
        )}
        {loading && !data ? <ActivityIndicator style={{ marginTop: 40 }} color={c.textSecondary} /> : (
          <FlatList
            data={docs}
            keyExtractor={(i) => String(i.id)}
            renderItem={({ item }) => (
              <DocumentRow item={item} theme={theme} thumbUri={thumbOf(item)} selectMode={selectMode} selected={selected.has(item.id)} progress={progress[item.id] ?? null}
                onPress={() => (selectMode ? toggle(item.id) : open(item))} onLongPress={() => { impactHaptic('medium'); toggle(item.id); }} testID={`row-${item.id}`} />
            )}
            ListHeaderComponent={header}
            ListFooterComponent={footer}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); try { await refresh(); } finally { setRefreshing(false); } }} tintColor={c.textSecondary} />}
            keyboardDismissMode="on-drag"
            scrollIndicatorInsets={{ right: 1 }}
            indicatorStyle={theme.mode === 'dark' ? 'white' : 'default'}
          />
        )}
        {selectMode && (
          <View style={[styles.bar, { backgroundColor: c.surfaceElevated || c.surface, borderTopColor: c.border, paddingBottom: Math.max(insets.bottom, bottomInset) + 8 }]}>
            <Text style={[styles.barCount, { color: c.textPrimary }]} numberOfLines={1}>{selected.size} selected</Text>
            <ActionButton haptic="light" accessibilityLabel="Move selection" onPress={() => setSheet({ kind: 'move-items' })} style={styles.barBtn}><Icon name="folder-move-outline" size={22} color={c.textPrimary} /><Text style={[styles.barLabel, { color: c.textPrimary }]}>Move</Text></ActionButton>
            <ActionButton haptic="light" accessibilityLabel="Tag selection" onPress={() => onBulkTag(selectedItems)} style={styles.barBtn}><Icon name="tag-outline" size={22} color={c.textPrimary} /><Text style={[styles.barLabel, { color: c.textPrimary }]}>Tag</Text></ActionButton>
            <ActionButton haptic="warning" accessibilityLabel="Delete selection" onPress={deleteSelected} style={styles.barBtn}><Icon name="trash-can-outline" size={22} color={danger} /><Text style={[styles.barLabel, { color: danger }]}>Delete</Text></ActionButton>
            <ActionButton accessibilityLabel="Cancel selection" onPress={clearSelection} style={styles.barBtn}><Icon name="close" size={22} color={c.textSecondary} /><Text style={[styles.barLabel, { color: c.textSecondary }]}>Cancel</Text></ActionButton>
          </View>
        )}
        {sheet?.kind === 'new' && <FolderNameSheet title="New folder" doneLabel="Create" error={sheet.error} onSubmit={submitName} onClose={() => setSheet(null)} theme={theme} bottomInset={bottomInset} />}
        {sheet?.kind === 'rename' && <FolderNameSheet title="Rename folder" doneLabel="Save" initial={sheet.folder.name} error={sheet.error} onSubmit={submitName} onClose={() => setSheet(null)} theme={theme} bottomInset={bottomInset} />}
        {(sheet?.kind === 'move-items' || sheet?.kind === 'move-folder' || sheet?.kind === 'delete-target') && (
          <FolderPickerSheet title={sheet.kind === 'delete-target' ? 'Move contents to' : 'Move to'} exclude={sheet.folder ? [sheet.folder.id] : []} onPick={pickTarget} onClose={() => setSheet(null)} theme={theme} bottomInset={bottomInset} base={base} />
        )}
        {sheet?.kind === 'sort' && <FilesSortSheet sort={sort} order={order} query={query} onChange={({ sort: s, order: o, query: q }) => { setSort(s); setOrder(o); setQuery(q); }} onClose={() => setSheet(null)} theme={theme} bottomInset={bottomInset} />}
        {sheet?.kind === 'actions' && (
          <FolderActionsSheet folder={sheet.folder} theme={theme} bottomInset={bottomInset} onClose={() => setSheet(null)}
            onRename={() => setSheet({ kind: 'rename', folder: sheet.folder })} onMove={() => setSheet({ kind: 'move-folder', folder: sheet.folder })} onDelete={() => askDelete(sheet.folder)} />
        )}
      </View>
    </EdgeSwipePage>
  );
}

function MenuRow({ icon, label, onPress, theme }) {
  return (
    <Pressable onPress={onPress} onPressIn={tapHaptic} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.menuRow, { opacity: pressed ? 0.6 : 1 }]}>
      <Icon name={icon} size={20} color={theme.colors.textPrimary} />
      <Text style={[styles.menuText, { color: theme.colors.textPrimary }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingBottom: 8, minHeight: 44 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  crumbs: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 4 },
  crumb: { fontSize: 13, flexShrink: 1 },
  crumbTail: { fontSize: 15, fontWeight: '700', flexShrink: 1 },
  crumbSep: { fontSize: 13 },
  menu: { position: 'absolute', right: 12, zIndex: 20, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 4, minWidth: 200 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44, paddingHorizontal: 14 },
  menuText: { fontSize: 14.5, fontWeight: '600', flexShrink: 1 },
  discs: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8, paddingBottom: 6 },
  section: { fontSize: 10.5, letterSpacing: 0.9, fontWeight: '700', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16 },
  play: { position: 'absolute', right: 6, bottom: 6, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  check: { position: 'absolute', left: 6, top: 6 },
  empty: { textAlign: 'center', paddingVertical: 40, fontSize: 13 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', paddingTop: 8, paddingHorizontal: 12, borderTopWidth: StyleSheet.hairlineWidth, zIndex: 50, gap: 4 },
  barCount: { fontSize: 13, fontWeight: '700', flexShrink: 1, marginRight: 6 },
  barBtn: { alignItems: 'center', justifyContent: 'center', minWidth: 56, minHeight: 44, flexShrink: 1 },
  barLabel: { fontSize: 11, marginTop: 2 },
});
