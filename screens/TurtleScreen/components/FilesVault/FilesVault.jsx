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
import { impactHaptic, tapHaptic } from '../../../../utils/haptics';
import useFolderData from './useFolderData';
import useFolderShares from './useFolderShares';
import { TILE_RADIUS } from './FolderTile';
import VaultShareSheet from '../VaultShareSheet';
import { insetRule } from '../../../../utils/surfaceDepth';
import { folderColor, folderTint, messageOf } from './filesUtils';
import {
  PICKER_GAP,
  VaultResultRow,
  VaultSearchDock,
  useVaultSearch,
} from '../VaultSearchDock';


/**
 * When a folder was made, for the line under its name.
 *
 * Short and absolute — "12 Mar 2026" — not "8 months ago". A relative stamp is
 * the right read for something you are tracking (a message, a task) and the
 * wrong one for an archive: the question a folder's date answers is "which
 * batch of work is this", and that is a date, not a distance.
 *
 * The year is dropped inside the current one, where it is noise on every row.
 *
 * Returns null rather than a string for anything unparseable, so a folder made
 * before the column existed shows its count alone instead of "Invalid Date".
 */
export function folderCreatedLabel(raw, now = Date.now()) {
  if (raw === null || raw === undefined || raw === '') return null;
  const ms = typeof raw === 'number' ? raw : Date.parse(String(raw));
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(undefined, sameYear
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
}


/**
 * The row's cover: FOUR of them, the way the tile drew it.
 *
 * A folder is a container of rectangular things and the collage is what says
 * how much is in it at a glance — one cover says "a folder", four say "a
 * folder with a lot in it". The row inherited a single cover when it was only
 * ever the search-result shape; now that the root IS this list, it takes the
 * tile's read back.
 *
 * Bigger than the stock row cover for the same reason: at 46 a 2x2 gives four
 * 23pt cells, which is thumbnail-of-a-thumbnail territory.
 */
const ROW_TILE = 58;

function RowCollage({ covers, base, theme, testID }) {
  const [failed, setFailed] = useState(() => new Set());
  const urls = useMemo(
    () => (covers || [])
      .map((t) => (String(t).startsWith('http') ? String(t) : `${String(base).replace(/\/api$/, '')}${t}`))
      .filter((u) => !failed.has(u))
      .slice(0, 4),
    [covers, base, failed],
  );
  const markFailed = useCallback((u) => setFailed((prev) => new Set(prev).add(u)), []);
  const half = ROW_TILE / 2;
  const cell = (u, style, i) => (
    <Image key={u + i} source={{ uri: u }} style={[{ position: 'absolute' }, style]} contentFit="cover" transition={80} onError={() => markFailed(u)} testID={testID ? `${testID}-cover` : undefined} />
  );
  // Degrades 4 -> 3 -> 2 -> 1 -> initial, the same ladder FolderTile walks, so
  // a cover that fails to load shrinks the collage instead of leaving a hole.
  if (urls.length === 1) return cell(urls[0], { left: 0, top: 0, width: ROW_TILE, height: ROW_TILE }, 0);
  if (urls.length === 2) return [cell(urls[0], { left: 0, top: 0, width: half, height: ROW_TILE }, 0), cell(urls[1], { left: half, top: 0, width: half, height: ROW_TILE }, 1)];
  if (urls.length === 3) return [cell(urls[0], { left: 0, top: 0, width: half, height: ROW_TILE }, 0), cell(urls[1], { left: half, top: 0, width: half, height: half }, 1), cell(urls[2], { left: half, top: half, width: half, height: half }, 2)];
  if (urls.length >= 4) return [cell(urls[0], { left: 0, top: 0, width: half, height: half }, 0), cell(urls[1], { left: half, top: 0, width: half, height: half }, 1), cell(urls[2], { left: 0, top: half, width: half, height: half }, 2), cell(urls[3], { left: half, top: half, width: half, height: half }, 3)];
  return null;
}

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

export default function FilesVault({ topInset = 0, bottomInset = 0, searchTopInset, chromePx, onScroll, onSearchActiveChange, onOpenMedia, onBulkTag, onUploadHere, getFullUrl, base, target = null, onTargetConsumed, theme: themeProp, stack = [], onStackChange = () => {} }) {
  const themeCtx = useTheme();
  const theme = themeProp || themeCtx.theme;
  const c = theme.colors;
  const insets = useSafeAreaInsets();
  const { api } = useServer();
  const { data, loading, error, refresh, createFolder } = useFolderData('root');
  // Which of these folders other people can already see. Independent of the
  // folder fetch on purpose — see useFolderShares on why it fails quietly.
  const { sharedCount } = useFolderShares();
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  // A create that the server rejected ("already exists here"), shown under the
  // field where the name still is — the sheet used to carry this inline and it
  // is the one thing about it worth keeping.
  const [createError, setCreateError] = useState(null);
  // Which folder's share settings are open, from a tap on its share mark.
  const [shareFolder, setShareFolder] = useState(null);
  // The dock's measured height. The list reserves it as top padding so that at
  // rest nothing has moved, and the dock travels over the list rather than
  // pushing it — which is what keeps content moving at 1x the scroll instead of
  // 2x (the whole reason this is not simply a translate on the wrapper).
  const [dockH, setDockH] = useState(0);
  const chromeShift = useMemo(() => (chromePx && dockH > 0
    ? { transform: [{ translateY: chromePx.interpolate({ inputRange: [0, dockH], outputRange: [0, -dockH], extrapolate: 'clamp' }) }] }
    : null), [chromePx, dockH]);

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

  /**
   * What sits under a folder's name: when it was made, and how much is in it.
   *
   * The DATE FIRST, because that is the one the list is now showing — the count
   * was already on the tile and is the lesser fact. A folder with no recorded
   * createdAt (anything made before the column, and the synthetic Unfiled row)
   * simply shows the count on its own rather than the word "Invalid Date".
   */
  const folderMeta = (f) => {
    const count = `${f.itemCount || 0} item${f.itemCount === 1 ? '' : 's'}`;
    const made = folderCreatedLabel(f.createdAt);
    return made ? `${made} · ${count}` : count;
  };

  const renderRow = (f, index) => {
    const shared = sharedCount(f.id);
    const hasCovers = (f.covers || []).length > 0;
    return (
      <View key={f.id}>
        {/* The app's one separator, between each folder and the next. An
            element of its own rather than a border on the row: insetRule is
            TWO hairlines a point apart, and on the row itself it would draw
            across its top edge too (STYLE-RULES §1). Not before the first —
            the list already has the search dock's edge above it. */}
        {index > 0 && <View pointerEvents="none" style={insetRule(theme)} />}
        <VaultResultRow
          name={f.name}
          meta={folderMeta(f)}
          theme={theme}
          onPress={() => open(f.id)}
          onLongPress={() => { impactHaptic('medium'); push(f.id); }}
          leadingStyle={styles.rowTile}
          // Hard right, clear of the name — which now has the whole row to run
          // in and no longer has to be cut to two words. It is its OWN target:
          // tapping the row opens the folder, tapping the mark asks the
          // question the mark raises — who exactly can see this?
          trailing={shared > 0 ? (
            <Pressable
              onPressIn={tapHaptic}
              onPress={() => setShareFolder({ id: f.id, name: f.name })}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={`Sharing for ${f.name}: ${shared} ${shared === 1 ? 'person' : 'people'}. Open share settings.`}
              testID={`files-share-${f.id}`}
              style={({ pressed }) => [styles.shareMark, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Icon name="account-multiple" size={13} color={c.accentInfo} />
              <Text style={[styles.shareCount, { color: c.accentInfo }]} numberOfLines={1}>{shared}</Text>
            </Pressable>
          ) : null}
          accessibilityLabel={`Open folder ${f.name}, ${folderMeta(f)}`}
          testID={`files-row-${f.id}`}
          leading={hasCovers
            ? <RowCollage covers={f.covers} base={base} theme={theme} testID={`files-row-${f.id}`} />
            : (
              <View style={[styles.rowInitial, { backgroundColor: folderTint(f.name, 0.22) }]}>
                <Text style={[styles.rowInitialText, { color: folderColor(f.name) }]}>{String(f.name || '?').trim().charAt(0).toUpperCase()}</Text>
              </View>
            )}
        />
      </View>
    );
  };

  return (
    <View style={[styles.page, { backgroundColor: c.background }]}>
      <Animated.View style={[styles.lift, { marginBottom: -lift }, search.liftStyle]}>
        {loading && !data ? <ActivityIndicator style={{ marginTop: 40 }} color={c.textSecondary} /> : (
          <Animated.ScrollView
            onScroll={onScroll}
            scrollEventThrottle={16}
            contentContainerStyle={[
              // ONE SHAPE, searching or not: the root is a list now, so results
              // are the same rows in the same place rather than a grid rearranging
              // itself into a list under the query.
              styles.rows,
              // The dock's room. Reserved by the LIST so the dock can float
              // over it and leave without the rows jumping up to fill the gap.
              // dockH ALONE. The dock is measured by onLayout, which reports
              // its full laid-out height — its own `topInset + PICKER_GAP`
              // padding included. Adding that padding again here counted the
              // header twice and left most of a screen of nothing above the
              // first folder. The fallback is for the frame before it measures.
              { paddingTop: dockH || (topInset + PICKER_GAP), paddingBottom: Math.max(insets.bottom, bottomInset) + 24 + lift },
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
                {/* Unfiled is the same ROW as the folders under it now, not a
                    tile in a grid — it is one of the things in this list and
                    reads as one. It has no cover and no creation date of its
                    own, so it takes the folder glyph and says only its count. */}
                <VaultResultRow
                  name="Unfiled"
                  meta={`${data?.unfiled?.count ?? 0} item${(data?.unfiled?.count ?? 0) === 1 ? '' : 's'}`}
                  theme={theme}
                  onPress={() => push('unfiled')}
                  accessibilityLabel="Open Unfiled"
                  testID="files-row-unfiled"
                  leading={<Icon name="file-outline" size={22} color={c.textSecondary} />}
                />
                {folders.map(renderRow)}
                {data && folders.length === 0 && (
                  <Text style={[styles.empty, { color: c.textMuted }]}>No folders yet. Folders you watch on your PC appear here on their own; name one in the field above.</Text>
                )}
                {!!error && <Text style={[styles.empty, { color: c.accentError || '#e5484d' }]}>{error}</Text>}
              </>
            )}
          </Animated.ScrollView>
        )}
        {/* THE DOCK FLOATS OVER THE LIST, and goes up with the vault header.
            Absolute and rendered last so it paints above the rows; the list
            reserves its height as top padding, so at rest nothing has moved and
            the rows simply pass under it as it leaves. Opaque for the same
            reason — a row sliding through the search field would be unreadable.

            It is NOT the wrapper that translates: moving dock and list together
            would carry content up at 2x the scroll. */}
        <Animated.View
          pointerEvents="box-none"
          onLayout={(e) => {
            const h = Math.round(e.nativeEvent.layout.height);
            // Thresholded: onLayout fires on sub-pixel wobble, and a state write
            // per frame would re-render the page mid-scroll.
            if (h > 0) setDockH((prev) => (Math.abs(prev - h) >= 1 ? h : prev));
          }}
          style={[styles.dockFloat, { paddingTop: topInset + PICKER_GAP, backgroundColor: c.background }, chromeShift]}
        >
          <VaultSearchDock
            search={search}
            theme={theme}
            placeholder="Search or name a folder"
            accessibilityLabel="Search your folders, or name a new one"
            cancelLabel="Cancel folder search"
            clearLabel="Clear folder search"
            trailingIcon="folder-plus"
            trailingIconSet="feather"
            trailingLabel="New folder"
            onTrailingPress={() => { tapHaptic(); search.beginSearch(); }}
            onChangeText={(q) => { setQuery(q); setCreateError(null); }}
            onSubmitEditing={canCreate ? submitCreate : undefined}
            returnKeyType={canCreate ? 'done' : 'search'}
            testIDPrefix="files-search"
          />
          {!!createError && <Text style={[styles.createError, { color: c.accentError || '#e5484d' }]}>{createError}</Text>}
        </Animated.View>
      </Animated.View>
      {/* Who can see this folder — pond members and public links. The same
          sheet the folder page and a board use, so there is ONE place those
          settings live however you got to them. */}
      {shareFolder && (
        <VaultShareSheet
          visible
          subject={{ kind: 'folder', id: shareFolder.id, name: shareFolder.name }}
          api={api}
          theme={theme}
          // The ORIGIN, not the api base — the sheet resolves member avatars
          // against it, the same strip the covers above use.
          baseUrl={String(base || '').replace(/\/api$/, '')}
          bottomInset={bottomInset}
          onClose={() => setShareFolder(null)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  dockFloat: { position: 'absolute', left: 0, right: 0, top: 0, zIndex: 5 },
  // The share mark, hard right of a row. Bare icon and count, the same pair
  // the tile caption used to carry.
  // Overrides VaultResultRow's stock 46pt cover: a 2x2 of 23pt cells is a
  // thumbnail of a thumbnail. 58 gives the four covers room to read.
  rowTile: { width: ROW_TILE, height: ROW_TILE, borderRadius: 12 },
  shareMark: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  shareCount: { fontSize: 12, fontWeight: '700' },
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
