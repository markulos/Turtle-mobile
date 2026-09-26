/**
 * FilesVault — the Files page of the vault pager. Root: an Unfiled tile and
 * the top-level folders as tiles; tapping pushes a FolderPage, one per level,
 * so the left-edge swipe pops exactly one. An open-target (search hit) for a
 * folder or document pushes the whole crumb chain. Contract mirrors MusicVault:
 * topInset/bottomInset, its own scroll, no onClose (a pager page has nothing to
 * go back to).
 *
 * FINDING AND MAKING are the same field — the vault's own (VaultSearchDock),
 * the one the Boards tab uses. It replaces a `+` in the toolbar that opened a
 * modal sheet with a name box in it: two taps and a cover over the page to do
 * the thing you were already looking at the page to do, and a second, unrelated
 * way of getting around one tab over. Type here and the folders filter to
 * rows; type a name that does not exist yet and the first row offers to make
 * it. The `+` key is still there and still means "new folder" — it just opens
 * the field rather than a sheet, so the name you type is also a search, and you
 * find out you already have a "Receipts" before you make the second one.
 *
 * The folder-page STACK is controlled by the caller (`stack`/`onStackChange`)
 * — MediaGallery owns the state and renders the actual FolderPage stack at
 * the gallery root, above the vault's own floating header, instead of here.
 * An opaque header painting over a page it doesn't own (and a pager swipe
 * reaching a page that should be modal over it) is exactly the bug that
 * split ownership avoids; see the "zIndex is load-bearing" note on
 * MediaGallery's photos page.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Keyboard, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useTheme } from '../../../../context/ThemeContext';
import { useServer } from '../../../../context/ServerContext';
import { tapHaptic } from '../../../../utils/haptics';
import useFolderData from './useFolderData';
import FolderTile, { TILE_RADIUS } from './FolderTile';
import { folderColor, folderTint, messageOf } from './filesUtils';
import {
  PICKER_GAP,
  VaultResultRow,
  VaultSearchDock,
  useVaultSearch,
} from '../VaultSearchDock';

/** Fold case and spacing so "Tax Returns" and "tax returns" are one name. */
const normalise = (s) => String(s || '').trim().toLowerCase();

/**
 * The folders a query matches, and whether the query IS one of them.
 *
 * `exact` is what decides whether the create row appears: offering to make a
 * "Receipts" while a folder called "Receipts" is the row underneath is how you
 * end up with two. A substring match is not enough to suppress it — "Tax" must
 * still be creatable next to "Taxes 2024".
 */
export function matchFolders(folders, query) {
  const q = normalise(query);
  if (!q) return { matches: folders || [], exact: false };
  const matches = (folders || []).filter((f) => normalise(f.name).includes(q));
  return { matches, exact: matches.some((f) => normalise(f.name) === q) };
}

export default function FilesVault({ topInset = 0, bottomInset = 0, searchTopInset, onSearchActiveChange, onOpenMedia, onBulkTag, onUploadHere, getFullUrl, base, target = null, onTargetConsumed, theme: themeProp, stack = [], onStackChange = () => {} }) {
  const themeCtx = useTheme();
  const theme = themeProp || themeCtx.theme;
  const c = theme.colors;
  const insets = useSafeAreaInsets();
  const { api } = useServer();
  const { data, loading, error, refresh, createFolder } = useFolderData('root');
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  // A create that the server rejected ("already exists here"), shown under the
  // field where the name still is — the sheet used to carry this inline and it
  // is the one thing about it worth keeping.
  const [createError, setCreateError] = useState(null);

  const folders = useMemo(() => data?.folders || [], [data]);
  const { matches, exact } = useMemo(() => matchFolders(folders, query), [folders, query]);

  // How far the page rises when search takes over: exactly the height of the
  // vault header it is being allowed to use (topInset covers that header;
  // searchTopInset is the bare safe area left once it has gone).
  const lift = Math.max(0, topInset - (searchTopInset ?? topInset));
  const search = useVaultSearch({
    query,
    items: matches,
    onQueryChange: (q) => { setQuery(q); setCreateError(null); },
    onSearchActiveChange,
    lift,
  });
  const { searching, displayQuery, displayItems } = search;

  // Always-current snapshot of `stack`, so push never appends onto a copy
  // captured by a stale closure — same pattern as useFolderData's dataRef.
  const stackRef = useRef(stack);
  stackRef.current = stack;
  const push = useCallback((parent) => onStackChange([...stackRef.current, { parent }]), [onStackChange]);

  /**
   * Opening a result ends the typing, so the keyboard goes. Only the KEYBOARD,
   * though — deliberately not the whole search: come back from the folder and
   * your query and its results are still there to pick the next one from,
   * instead of a page that threw the search away behind your back.
   */
  const open = useCallback((id) => { Keyboard.dismiss(); push(id); }, [push]);

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

  /**
   * Create what is in the field, then LEAVE search and open it — the same trip
   * the sheet's Create key made, minus the sheet. A rejection keeps the query
   * (and the keyboard) so the name can be edited rather than retyped.
   */
  const submitCreate = useCallback(async () => {
    const name = displayQuery.trim();
    if (!name) return;
    try {
      const { folder } = await createFolder(name);
      setCreateError(null);
      search.cancelSearch();
      // Offline the create is QUEUED and there is no real id yet, only the
      // optimistic row — so there is nothing to open. The folder is already on
      // the page behind the closing field either way.
      if (folder?.id) push(folder.id);
    } catch (e) {
      setCreateError(messageOf(e));
    }
  }, [displayQuery, createFolder, search, push]);

  // The create row shows for any name that is not already a folder here. It is
  // FIRST, not last: you typed a name, and the thing you are most likely to
  // want is the thing you named — the matches underneath are the check that you
  // do not need to.
  const canCreate = !!displayQuery.trim() && !exact;

  const renderTile = (f) => (
    <FolderTile key={f.id} name={f.name} covers={f.covers} count={f.itemCount} base={base} theme={theme} pending={!!f.pending} onPress={() => push(f.id)} testID={`root-${f.id}`} />
  );

  const renderRow = (f) => {
    const cover = (f.covers || [])[0];
    const url = cover && (String(cover).startsWith('http') ? String(cover) : `${String(base).replace(/\/api$/, '')}${cover}`);
    return (
      <VaultResultRow
        key={f.id}
        name={f.name}
        meta={`${f.itemCount || 0} item${f.itemCount === 1 ? '' : 's'}`}
        theme={theme}
        onPress={() => open(f.id)}
        accessibilityLabel={`Open folder ${f.name}, ${f.itemCount || 0} items`}
        testID={`files-row-${f.id}`}
        leading={url
          ? <Image source={{ uri: url }} style={StyleSheet.absoluteFillObject} contentFit="cover" transition={120} recyclingKey={`row:${cover}`} />
          : (
            <View style={[styles.rowInitial, { backgroundColor: folderTint(f.name, 0.22) }]}>
              <Text style={[styles.rowInitialText, { color: folderColor(f.name) }]}>{String(f.name || '?').trim().charAt(0).toUpperCase()}</Text>
            </View>
          )}
      />
    );
  };

  return (
    <View style={[styles.page, { backgroundColor: c.background }]}>
      <Animated.View style={[styles.lift, { marginBottom: -lift, paddingTop: topInset }, search.liftStyle]}>
        <View style={[styles.dock, { paddingTop: PICKER_GAP }]}>
          <VaultSearchDock
            search={search}
            theme={theme}
            placeholder="Search or name a folder"
            accessibilityLabel="Search your folders, or name a new one"
            cancelLabel="Cancel folder search"
            clearLabel="Clear folder search"
            trailingIcon="folder-plus-outline"
            trailingLabel="New folder"
            onTrailingPress={() => { tapHaptic(); search.beginSearch(); }}
            onChangeText={(q) => { setQuery(q); setCreateError(null); }}
            onSubmitEditing={canCreate ? submitCreate : undefined}
            returnKeyType={canCreate ? 'done' : 'search'}
            testIDPrefix="files-search"
          />
          {!!createError && <Text style={[styles.createError, { color: c.accentError || '#e5484d' }]}>{createError}</Text>}
        </View>
        {loading && !data ? <ActivityIndicator style={{ marginTop: 40 }} color={c.textSecondary} /> : (
          <ScrollView
            contentContainerStyle={[
              searching ? styles.rows : styles.grid,
              { paddingBottom: Math.max(insets.bottom, bottomInset) + 24 + lift },
            ]}
            refreshControl={searching ? undefined : <RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); try { await refresh(); } finally { setRefreshing(false); } }} tintColor={c.textSecondary} />}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            scrollIndicatorInsets={{ right: 1 }}
            indicatorStyle={theme.mode === 'dark' ? 'white' : 'default'}
          >
            {searching ? (
              <>
                {canCreate && (
                  <VaultResultRow
                    name={`Create “${displayQuery.trim()}”`}
                    meta="New folder here"
                    theme={theme}
                    onPress={submitCreate}
                    accessibilityLabel={`Create a folder called ${displayQuery.trim()}`}
                    testID="files-create-row"
                    leading={<Icon name="folder-plus-outline" size={22} color={c.textSecondary} />}
                  />
                )}
                {displayItems.map(renderRow)}
                {!canCreate && displayItems.length === 0 && (
                  <Text style={[styles.empty, { color: c.textMuted }]}>{`No folders match “${displayQuery}”.`}</Text>
                )}
              </>
            ) : (
              <>
                <Pressable delayPressIn={0} onPressIn={tapHaptic} onPress={() => push('unfiled')} accessibilityRole="button" accessibilityLabel="Open Unfiled" style={({ pressed }) => [styles.unfiled, { opacity: pressed ? 0.6 : 1 }]}>
                  <View style={[styles.unfiledTile, { backgroundColor: c.surface, borderColor: c.border }]}><Icon name="file-outline" size={28} color={c.textSecondary} /></View>
                  <Text style={[styles.discName, { color: c.textPrimary }]} numberOfLines={1}>Unfiled</Text>
                  <Text style={[styles.discCount, { color: c.textMuted }]} numberOfLines={1}>{data?.unfiled?.count ?? 0}</Text>
                </Pressable>
                {folders.map(renderTile)}
                {data && folders.length === 0 && (
                  <Text style={[styles.empty, { color: c.textMuted }]}>No folders yet. Folders you watch on your PC appear here on their own; name one in the field above.</Text>
                )}
                {!!error && <Text style={[styles.empty, { color: c.accentError || '#e5484d' }]}>{error}</Text>}
              </>
            )}
          </ScrollView>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  // The lifting layer. Its negative bottom margin is static: it is always
  // `lift` taller than the page, so the rise is a transform with nothing
  // underneath it to re-lay out.
  lift: { flex: 1 },
  dock: { paddingHorizontal: 16, paddingBottom: 10 },
  createError: { fontSize: 12.5, lineHeight: 17, marginTop: 8, paddingHorizontal: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8 },
  rows: { paddingHorizontal: 14 },
  unfiled: { alignItems: 'center', width: 88, paddingVertical: 6 },
  // Unfiled is a folder that happens to have no name, so it is the same shape
  // as the folders beside it — same 72, same corner, taken from FolderTile so
  // the two cannot drift apart.
  unfiledTile: { width: 72, height: 72, borderRadius: TILE_RADIUS, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  discName: { marginTop: 6, fontSize: 12.5, fontWeight: '600', flexShrink: 1 },
  discCount: { fontSize: 11, marginTop: 1, flexShrink: 1 },
  // A folder with no covers gets the same tinted initial its tile would show,
  // so a row and a tile are recognisably the same folder.
  rowInitial: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  rowInitialText: { fontSize: 18, fontWeight: '700' },
  empty: { width: '100%', textAlign: 'center', paddingVertical: 24, paddingHorizontal: 24, fontSize: 13, lineHeight: 19 },
});
