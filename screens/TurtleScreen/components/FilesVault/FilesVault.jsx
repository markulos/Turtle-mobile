/**
 * FilesVault — the Files page of the vault pager. Root: an Unfiled disc and
 * the top-level folders as board-style discs; tapping pushes a FolderPage,
 * one per level, so the left-edge swipe pops exactly one. An open-target
 * (search hit) for a folder or document pushes the whole crumb chain.
 * Contract mirrors MusicVault: topInset/bottomInset, its own scroll, no
 * onClose (a pager page has nothing to go back to).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../../context/ThemeContext';
import { useServer } from '../../../../context/ServerContext';
import { tapHaptic } from '../../../../utils/haptics';
import useFolderData from './useFolderData';
import FolderDisc from './FolderDisc';
import FolderPage from './FolderPage';
import { FolderNameSheet } from './FolderSheets';

export default function FilesVault({ topInset = 0, bottomInset = 0, onOpenMedia, onBulkTag, onUploadHere, getFullUrl, base, target = null, onTargetConsumed, theme: themeProp }) {
  const themeCtx = useTheme();
  const theme = themeProp || themeCtx.theme;
  const c = theme.colors;
  const insets = useSafeAreaInsets();
  const { api } = useServer();
  const { data, loading, error, refresh, createFolder } = useFolderData('root');
  const [stack, setStack] = useState([]); // [{ parent }]
  const [naming, setNaming] = useState(null); // null | { error }
  const [refreshing, setRefreshing] = useState(false);

  const push = useCallback((parent) => setStack((s) => [...s, { parent }]), []);
  const pop = useCallback(() => setStack((s) => s.slice(0, -1)), []);

  // Search hit → the crumb chain of the target folder (a document's folder,
  // or Unfiled), one page per crumb, so Back walks up naturally.
  useEffect(() => {
    if (!target) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const folderId = target.kind === 'folder' ? target.id : (target.item?.folder_id || null);
        if (!folderId) { if (!cancelled) setStack([{ parent: 'unfiled' }]); return; }
        const r = await api.get(`/folders?parent=${encodeURIComponent(folderId)}&limit=1`);
        const path = Array.isArray(r?.path) ? r.path : [];
        if (!cancelled) setStack(path.length ? path.map((p) => ({ parent: p.id })) : [{ parent: folderId }]);
      } catch { /* the target's folder is gone; stay on the root */ }
      finally { onTargetConsumed?.(); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const submitName = useCallback(async (name) => {
    try { await createFolder(name); setNaming(null); }
    catch (e) { setNaming({ error: e?.message || 'Not saved' }); }
  }, [createFolder]);

  const folders = data?.folders || [];
  return (
    <View style={[styles.page, { backgroundColor: c.background, paddingTop: topInset }]}>
      <View style={styles.toolbar}>
        <Text style={[styles.title, { color: c.textPrimary }]} numberOfLines={1}>Files</Text>
        <Pressable onPressIn={tapHaptic} onPress={() => setNaming({})} hitSlop={10} accessibilityRole="button" accessibilityLabel="New folder" style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.6 : 1 }]}>
          <Icon name="folder-plus-outline" size={24} color={c.textPrimary} />
        </Pressable>
      </View>
      {loading && !data ? <ActivityIndicator style={{ marginTop: 40 }} color={c.textSecondary} /> : (
        <ScrollView
          contentContainerStyle={[styles.grid, { paddingBottom: Math.max(insets.bottom, bottomInset) + 24 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); try { await refresh(); } finally { setRefreshing(false); } }} tintColor={c.textSecondary} />}
          scrollIndicatorInsets={{ right: 1 }}
          indicatorStyle={theme.mode === 'dark' ? 'white' : 'default'}
        >
          <Pressable delayPressIn={0} onPressIn={tapHaptic} onPress={() => push('unfiled')} accessibilityRole="button" accessibilityLabel="Open Unfiled" style={({ pressed }) => [styles.unfiled, { opacity: pressed ? 0.6 : 1 }]}>
            <View style={[styles.unfiledDisc, { backgroundColor: c.surface, borderColor: c.border }]}><Icon name="file-outline" size={28} color={c.textSecondary} /></View>
            <Text style={[styles.discName, { color: c.textPrimary }]} numberOfLines={1}>Unfiled</Text>
            <Text style={[styles.discCount, { color: c.textMuted }]} numberOfLines={1}>{data?.unfiled?.count ?? 0}</Text>
          </Pressable>
          {folders.map((f) => (
            <FolderDisc key={f.id} name={f.name} covers={f.covers} count={f.itemCount} base={base} theme={theme} pending={!!f.pending} onPress={() => push(f.id)} testID={`root-${f.id}`} />
          ))}
          {data && folders.length === 0 && (
            <Text style={[styles.empty, { color: c.textMuted }]}>No folders yet. Folders you watch on your PC appear here on their own; make one with the folder key above.</Text>
          )}
          {!!error && <Text style={[styles.empty, { color: c.accentError || '#e5484d' }]}>{error}</Text>}
        </ScrollView>
      )}
      {stack.map((level, i) => (
        <FolderPage
          key={`${level.parent}-${i}`}
          visible
          parent={level.parent}
          onClose={pop}
          onOpenFolder={(f) => push(f.id)}
          onOpenMedia={onOpenMedia}
          onBulkTag={onBulkTag}
          onUploadHere={onUploadHere}
          getFullUrl={getFullUrl}
          base={base}
          theme={theme}
          topInset={0}
          bottomInset={bottomInset}
        />
      ))}
      {naming && <FolderNameSheet title="New folder" doneLabel="Create" error={naming.error} onSubmit={submitName} onClose={() => setNaming(null)} theme={theme} bottomInset={bottomInset} />}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  toolbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 6, minHeight: 44 },
  title: { flex: 1, fontSize: 17, fontWeight: '700' },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8 },
  unfiled: { alignItems: 'center', width: 88, paddingVertical: 6 },
  unfiledDisc: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  discName: { marginTop: 6, fontSize: 12.5, fontWeight: '600' },
  discCount: { fontSize: 11, marginTop: 1 },
  empty: { width: '100%', textAlign: 'center', paddingVertical: 24, paddingHorizontal: 24, fontSize: 13, lineHeight: 19 },
});
