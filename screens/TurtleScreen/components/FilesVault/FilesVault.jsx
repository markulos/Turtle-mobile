/**
 * FilesVault — the Files page of the vault pager. Root: an Unfiled disc and
 * the top-level folders as board-style discs; tapping pushes a FolderPage,
 * one per level, so the left-edge swipe pops exactly one. An open-target
 * (search hit) for a folder or document pushes the whole crumb chain.
 * Contract mirrors MusicVault: topInset/bottomInset, its own scroll, no
 * onClose (a pager page has nothing to go back to).
 *
 * The folder-page STACK is controlled by the caller (`stack`/`onStackChange`)
 * — MediaGallery owns the state and renders the actual FolderPage stack at
 * the gallery root, above the vault's own floating header, instead of here.
 * An opaque header painting over a page it doesn't own (and a pager swipe
 * reaching a page that should be modal over it) is exactly the bug that
 * split ownership avoids; see the "zIndex is load-bearing" note on
 * MediaGallery's photos page.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../../context/ThemeContext';
import { useServer } from '../../../../context/ServerContext';
import { tapHaptic } from '../../../../utils/haptics';
import useFolderData from './useFolderData';
import FolderDisc from './FolderDisc';
import { FolderNameSheet } from './FolderSheets';
import { messageOf } from './filesUtils';

export default function FilesVault({ topInset = 0, bottomInset = 0, onOpenMedia, onBulkTag, onUploadHere, getFullUrl, base, target = null, onTargetConsumed, theme: themeProp, stack = [], onStackChange = () => {} }) {
  const themeCtx = useTheme();
  const theme = themeProp || themeCtx.theme;
  const c = theme.colors;
  const insets = useSafeAreaInsets();
  const { api } = useServer();
  const { data, loading, error, refresh, createFolder } = useFolderData('root');
  const [naming, setNaming] = useState(null); // null | { error }
  const [refreshing, setRefreshing] = useState(false);

  // Always-current snapshot of `stack`, so push never appends onto a copy
  // captured by a stale closure — same pattern as useFolderData's dataRef.
  const stackRef = useRef(stack);
  stackRef.current = stack;
  const push = useCallback((parent) => onStackChange([...stackRef.current, { parent }]), [onStackChange]);

  // Search hit → the crumb chain of the target folder (a document's folder,
  // or Unfiled), one page per crumb, so Back walks up naturally.
  useEffect(() => {
    if (!target) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const folderId = target.kind === 'folder' ? target.id : (target.item?.folder_id || null);
        if (!folderId) { if (!cancelled) onStackChange([{ parent: 'unfiled' }]); return; }
        const r = await api.get(`/folders?parent=${encodeURIComponent(folderId)}&limit=1`);
        const path = Array.isArray(r?.path) ? r.path : [];
        if (!cancelled) onStackChange(path.length ? path.map((p) => ({ parent: p.id })) : [{ parent: folderId }]);
      } catch { /* the target's folder is gone; stay on the root */ }
      finally { onTargetConsumed?.(); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const submitName = useCallback(async (name) => {
    try { await createFolder(name); setNaming(null); }
    catch (e) { setNaming({ error: messageOf(e) }); }
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
  discName: { marginTop: 6, fontSize: 12.5, fontWeight: '600', flexShrink: 1 },
  discCount: { fontSize: 11, marginTop: 1, flexShrink: 1 },
  empty: { width: '100%', textAlign: 'center', paddingVertical: 24, paddingHorizontal: 24, fontSize: 13, lineHeight: 19 },
});
