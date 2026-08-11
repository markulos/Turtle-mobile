import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, ActivityIndicator, StyleSheet, Pressable, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useSharedValue } from 'react-native-reanimated';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../../../context/ThemeContext';
import { useMusicPlayer } from '../../../context/MusicPlayerContext';
import { useServer } from '../../../context/ServerContext';
import { titleOf, sourceOf, resolveMediaUrl } from '../../../services/musicTrackMapper';
import { TAP_ONLY } from '../../../utils/pressBehavior';
import { tapHaptic } from '../../../utils/haptics';
import { sendOrQueue, subscribe as subscribeOfflineQueue, loadQueue } from '../../../services/offlineQueue';
import TrackActionsSheet from './TrackActionsSheet';
import EdgeSwipePage from './EdgeSwipePage';
import TimelineScrubber from './TimelineScrubber';

// Tags double as playlists for audio: the vault already models "a named group of
// media" as a tag, so a music playlist is just a tag on an audio row. This reads
// one row's tags out of the JSON column the gallery returns.
const tagsOf = (row) => {
  try {
    const parsed = JSON.parse(row?.tags || '[]');
    return Array.isArray(parsed) ? parsed.filter((t) => typeof t === 'string') : [];
  } catch {
    return [];
  }
};

// The music player's single tint. `accent` is the user's chosen highlight
// colour, folded into the palette by ThemeContext — so the player follows
// whatever the rest of the app is tinted with instead of being permanently
// green. accentInfo is the same value (ThemeContext repoints it) and is the
// fallback for any theme that predates `accent`.
const MUSIC_TINT = (c) => c.accent || c.accentInfo || c.primary;

// Outbox key for a track rename — one pending rename per track, newest wins.
const renameKey = (id) => `media:${id}:originalName`;

const fmtTime = (sec) => {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * topInset — height to clear at the top. As a page of the vault's pager the
 * component sits UNDER that screen's absolutely-positioned header (title + the
 * Boards/Music picker), so the caller passes the header's measured height plus
 * the gap; without it the first track cards render behind the picker.
 *
 * onClose — only supplied when MusicVault is pushed as its own screen. In the
 * pager there is nothing to go back to and the vault header already names the
 * page, so the internal back/title row is omitted.
 */
export default function MusicVault({ onClose, topInset = 0, bottomInset = 0 }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const insets = useSafeAreaInsets();
  const {
    tracks,
    loading,
    ready,
    error,
    setupError,
    activeTrack,
    isPlaying,
    position,
    duration,
    playMedia,
    togglePlayback,
    previous,
    next,
    seekTo,
    refreshLibrary,
    retrySetup,
  } = useMusicPlayer();
  const { api, getBaseUrl, getMediaBaseUrl } = useServer();
  // Ids removed locally by a delete that hasn't round-tripped yet. Deleting is
  // optimistic (app-wide rule): the row leaves the list on the tap and only
  // comes back if the server rejects it.
  const [removedIds, setRemovedIds] = useState(() => new Set());
  // Locally-applied renames, id → new originalName. Same optimistic rule as the
  // delete above: the new name is on screen the instant it's typed, the PATCH
  // rides behind it. Entries stay after the refresh lands (they then match the
  // server value, so there's no flash); only a failed write clears one.
  const [renamedNames, setRenamedNames] = useState(() => new Map());
  const visibleTracks = useMemo(() => {
    let list = removedIds.size ? tracks.filter((t) => !removedIds.has(String(t.id))) : tracks;
    if (renamedNames.size) {
      list = list.map((t) => {
        const next = renamedNames.get(String(t.id));
        return next && next !== t.originalName ? { ...t, originalName: next } : t;
      });
    }
    return list;
  }, [tracks, removedIds, renamedNames]);

  // Renames that are still sitting in the offline outbox are re-applied here on
  // mount — that's what makes an offline edit survive an app restart: the queue
  // entry IS the record of it, and the vault paints from it until it lands.
  // Merge-only (never removes): an entry leaving the queue means it was SENT,
  // and dropping the override in that instant would flash the old name back
  // before the library refresh arrives.
  useEffect(() => {
    loadQueue().catch(() => {});
    return subscribeOfflineQueue((entries) => {
      const parked = [];
      const parkedDeletes = [];
      entries.forEach((e) => {
        const rename = /^media:(.+):originalName$/.exec(e?.key || '');
        if (rename && e?.body?.originalName) parked.push([rename[1], e.body.originalName]);
        const del = /^media:(.+):delete$/.exec(e?.key || '');
        if (del) parkedDeletes.push(del[1]);
      });
      if (parked.length) {
        setRenamedNames((prev) => {
          const fresh = parked.filter(([id, name]) => prev.get(id) !== name);
          if (!fresh.length) return prev;
          const next = new Map(prev);
          fresh.forEach(([id, name]) => next.set(id, name));
          return next;
        });
      }
      // A delete parked before the app was killed: keep the row hidden rather
      // than resurrecting it for the seconds between launch and flush.
      if (parkedDeletes.length) {
        setRemovedIds((prev) => {
          const fresh = parkedDeletes.filter((id) => !prev.has(id));
          if (!fresh.length) return prev;
          const next = new Set(prev);
          fresh.forEach((id) => next.add(id));
          return next;
        });
      }
    });
  }, []);
  const current = visibleTracks.findIndex(
    (item) => String(item.id) === String(activeTrack?.mediaId)
  );
  const nowTrack = current >= 0 ? visibleTracks[current] : null;
  const barWidthRef = useRef(1);

  // The track whose "⋯" was tapped (null = sheet closed). Held by ID and
  // re-resolved from the live list, so a library refresh mid-sheet can't leave
  // the sheet acting on a stale row.
  const [sheetId, setSheetId] = useState(null);
  const [sheetBusy, setSheetBusy] = useState(false);
  const sheetTrack = useMemo(
    () => visibleTracks.find((t) => String(t.id) === String(sheetId)) || null,
    [visibleTracks, sheetId]
  );
  const closeSheet = useCallback(() => setSheetId(null), []);

  // Measured height of the pinned transport bar, used as the list's bottom
  // padding so the last track can always scroll clear of it. MEASURED, not a
  // constant: the bar is seek strip + times + controls + a dock-clearing
  // paddingBottom that varies with the device's safe area, and the 150pt guess
  // this replaced was ~80pt short — the final row sat under the player with no
  // way to scroll it out.
  const [nowBarH, setNowBarH] = useState(0);

  // ── A–Z scrub rail ─────────────────────────────────────────────────────────
  // The rail used to belong to the Boards page only, so swiping to Music left
  // you with no way to move through a few hundred tracks except flicking. Music
  // now carries its own, driven by this list's own scroll.
  const listRef = useRef(null);
  const musicContentH = useRef(0);
  const musicLayoutH = useRef(0);
  const musicScrollY = useSharedValue(0);
  const musicMaxScroll = useSharedValue(1);

  // Group the list into runs of the same initial. NOTE: `starts` must follow the
  // list's REAL order, which is newest-upload-first — not A→Z. That's why no
  // `yearMarks` are emitted: those paint fixed letter ticks down the rail, and
  // on a non-alphabetical list they'd read as a broken index. The rail is a
  // clean track with a bubble that names the letter you're currently over, which
  // is correct at any sort order.
  const musicScrubData = useMemo(() => {
    const total = visibleTracks.length;
    if (total < 2) return { starts: [], labels: [], countLabels: [], total: 0, yearMarks: [] };
    const letterOf = (row) => {
      const ch = String(titleOf(row) || '').trim().charAt(0).toUpperCase();
      return ch >= 'A' && ch <= 'Z' ? ch : '#';
    };
    const starts = []; const labels = []; const counts = [];
    let last = null;
    for (let i = 0; i < total; i++) {
      const L = letterOf(visibleTracks[i]);
      if (L !== last) {
        last = L;
        starts.push(i);
        labels.push(L);
        counts.push(0);
      }
      counts[counts.length - 1] += 1;
    }
    return {
      starts,
      labels,
      countLabels: counts.map((n) => `${n} track${n === 1 ? '' : 's'}`),
      total,
      yearMarks: [],
    };
  }, [visibleTracks]);

  // A rail over a handful of tracks is noise — same threshold the Boards rail uses.
  const musicScrubEnabled = visibleTracks.length >= 20;

  const handleMusicScroll = useCallback((e) => {
    const ne = e && e.nativeEvent;
    if (!ne) return;
    if (ne.contentSize?.height) musicContentH.current = ne.contentSize.height;
    if (ne.layoutMeasurement?.height) musicLayoutH.current = ne.layoutMeasurement.height;
    musicScrollY.value = (ne.contentOffset && ne.contentOffset.y) || 0;
    musicMaxScroll.value = Math.max(1, musicContentH.current - musicLayoutH.current);
  }, [musicScrollY, musicMaxScroll]);

  // Plain top-down list, so the drag fraction maps straight to a scroll offset.
  const handleMusicScrubJump = useCallback((dataFrac) => {
    const f = Math.min(1, Math.max(0, dataFrac));
    const offset = f * Math.max(1, musicContentH.current - musicLayoutH.current);
    musicScrollY.value = offset;
    try {
      listRef.current?.scrollToOffset?.({ offset, animated: false });
    } catch (err) { /* mid-layout — the next jump lands */ }
  }, [musicScrollY]);

  // Playlists are derived from the AUDIO library's own tags, not the global
  // album list — so the picker offers music playlists rather than every photo
  // board in the vault. No extra request: the rows already carry their tags.
  // Built as name → tracks in ONE pass, because both consumers (the picker's
  // name list and the playlists page's rows) need it and walking the library
  // twice for the same data is wasteful on a 300-track page.
  const playlistIndex = useMemo(() => {
    const byName = new Map();
    for (const t of visibleTracks) {
      for (const tag of tagsOf(t)) {
        const list = byName.get(tag);
        if (list) list.push(t);
        else byName.set(tag, [t]);
      }
    }
    return byName;
  }, [visibleTracks]);
  const playlists = useMemo(
    () => Array.from(playlistIndex.keys()).sort((a, b) => a.localeCompare(b)),
    [playlistIndex]
  );

  // ── Playlists page ─────────────────────────────────────────────────────────
  // Pushed over the library as an EdgeSwipePage (the app's push-page primitive),
  // so it arrives from the right and a left-edge swipe takes you back to all
  // songs — the same back gesture every other pushed page in the app uses.
  // `openPlaylist` is the second level: null = the list of playlists, a name =
  // that playlist's tracks.
  const [playlistsOpen, setPlaylistsOpen] = useState(false);
  const [openPlaylist, setOpenPlaylist] = useState(null);
  const closePlaylists = useCallback(() => {
    setPlaylistsOpen(false);
    setOpenPlaylist(null);
  }, []);
  const openPlaylistTracks = openPlaylist ? (playlistIndex.get(openPlaylist) || []) : [];

  useFocusEffect(
    useCallback(() => {
      refreshLibrary();
    }, [refreshLibrary])
  );

  // Play by ITEM, not by list index: the same row renderer serves the full
  // library and a playlist, and an index only means something in the list it
  // came from.
  const playTrack = useCallback(
    (item) => {
      if (item?.id != null) playMedia(String(item.id));
    },
    [playMedia]
  );

  // ── Track actions (the ⋯ sheet) ────────────────────────────────────────────

  // Play, or pause if this row is already the one playing — the sheet's first
  // row mirrors whatever the transport would do for this track.
  const sheetPlay = useCallback(() => {
    const item = sheetTrack;
    closeSheet();
    if (!item || !ready) return;
    if (String(item.id) === String(activeTrack?.mediaId)) togglePlayback();
    else playMedia(String(item.id));
  }, [sheetTrack, ready, activeTrack, togglePlayback, playMedia, closeSheet]);

  // Pull the audio file into the cache and hand it to the OS share sheet, then
  // drop the copy — same shape as the photo vault's share, so repeated shares
  // don't pile up duplicates in the cache directory.
  const sheetShare = useCallback(async () => {
    const item = sheetTrack;
    if (!item) return;
    const base = (getMediaBaseUrl ? getMediaBaseUrl() : getBaseUrl()).replace(/\/api$/, '');
    const url = resolveMediaUrl(item.rawUrl || item.url, base);
    if (!url) {
      Alert.alert('Share', 'That track has no downloadable file.');
      return;
    }
    setSheetBusy(true);
    let localUri = null;
    try {
      const safeName = (item.filename || `track_${item.id}.mp3`).replace(/[^\w.\-]/g, '_');
      localUri = `${FileSystem.cacheDirectory}shared_${item.id}_${safeName}`;
      const { uri } = await FileSystem.downloadAsync(url, localUri);
      closeSheet();
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { UTI: 'public.audio', mimeType: item.mimeType || 'audio/mpeg' });
      } else {
        Alert.alert('Share', 'Sharing is not available on this device.');
      }
    } catch (e) {
      console.warn('[MusicVault] share failed:', e?.message || e);
      Alert.alert('Share', 'Could not prepare that track.');
    } finally {
      setSheetBusy(false);
      if (localUri) FileSystem.deleteAsync(localUri, { idempotent: true }).catch(() => {});
    }
  }, [sheetTrack, getBaseUrl, getMediaBaseUrl, closeSheet]);

  // Rename = patch the row's originalName, which is the label titleOf() reads.
  // The file on disk is untouched (that's `filename`), so this is a pure
  // metadata edit. The extension is carried over from the old name because
  // titleOf strips a trailing extension for display — dropping it would make
  // "Take.Five" render as "Take" on the next load.
  // Offline-safe: sendOrQueue tries the PATCH now and parks it in the durable
  // outbox if the pond can't be reached, so a rename on the subway survives
  // both the dead network AND an app restart — it's replayed on reconnect. Only
  // a PERMANENT failure (a 4xx: gone, not yours) rejects and reverts.
  const sheetRename = useCallback(
    (name) => {
      const item = sheetTrack;
      const clean = String(name || '').trim();
      if (!item || !clean) return;
      const id = String(item.id);
      const prevName = item.originalName || item.filename || '';
      const ext = (String(prevName).match(/\.[a-z0-9]{2,5}$/i) || [''])[0];
      const nextName = clean.endsWith(ext) ? clean : `${clean}${ext}`;
      if (nextName === prevName) { closeSheet(); return; }

      closeSheet();
      setRenamedNames((prev) => new Map(prev).set(id, nextName));
      sendOrQueue(api, {
        method: 'patch',
        path: `/media/${id}`,
        body: { originalName: nextName },
        // Rename it three times offline and only the last one is sent.
        key: renameKey(id),
        label: `Rename “${clean}”`,
      })
        .then(({ queued }) => { if (!queued) refreshLibrary(); })
        .catch((e) => {
          console.warn('[MusicVault] rename failed:', e?.message || e);
          setRenamedNames((prev) => {
            const next = new Map(prev);
            next.delete(id);
            return next;
          });
          Alert.alert('Rename', 'Could not rename that track.');
        });
    },
    [sheetTrack, api, refreshLibrary, closeSheet]
  );

  // Playlists are tags, and the tags endpoint REPLACES the list — so send the
  // union of what the row already has plus the new name. Closes immediately and
  // persists in the background; offline it parks in the outbox, and only a
  // permanent failure alerts + refreshes the true state back.
  //
  // NOT keyed: each add carries the full tag list it computed at the time, so
  // collapsing two adds would silently drop the first playlist.
  const sheetAddToPlaylist = useCallback(
    (name) => {
      const item = sheetTrack;
      const clean = String(name || '').trim();
      if (!item || !clean) return;
      closeSheet();
      const next = Array.from(new Set([...tagsOf(item), clean]));
      sendOrQueue(api, {
        method: 'put',
        path: `/media/${item.id}/tags`,
        body: { tags: next },
        label: `Add to ${clean}`,
      })
        .then(({ queued }) => { if (!queued) refreshLibrary(); })
        .catch((e) => {
          console.warn('[MusicVault] playlist add failed:', e?.message || e);
          Alert.alert('Playlist', `Could not add “${titleOf(item)}” to ${clean}.`);
          refreshLibrary();
        });
    },
    [sheetTrack, api, refreshLibrary, closeSheet]
  );

  const sheetDelete = useCallback(() => {
    const item = sheetTrack;
    if (!item) return;
    const id = String(item.id);
    Alert.alert(
      'Delete track',
      `Remove “${titleOf(item)}” from the vault? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            closeSheet();
            // Optimistic: hide it now, un-hide only if the server REFUSES it.
            // Offline is not a refusal — the delete parks in the outbox and the
            // row stays gone, which is what the user asked for.
            setRemovedIds((prev) => new Set(prev).add(id));
            sendOrQueue(api, {
              method: 'delete',
              path: `/media/${id}`,
              key: `media:${id}:delete`,
              label: `Delete “${titleOf(item)}”`,
            })
              .then(({ queued }) => { if (!queued) refreshLibrary(); })
              .catch((e) => {
                console.warn('[MusicVault] delete failed:', e?.message || e);
                setRemovedIds((prev) => {
                  const next = new Set(prev);
                  next.delete(id);
                  return next;
                });
                Alert.alert('Delete', 'Could not delete that track.');
              });
          },
        },
      ]
    );
  }, [sheetTrack, api, refreshLibrary, closeSheet]);

  const seekFromFraction = useCallback(
    (fraction) => {
      if (!duration) return;
      seekTo(Math.max(0, Math.min(duration, fraction * duration)));
    },
    [duration, seekTo]
  );

  // Track-row styles hoisted out of renderTrack — the old inline objects
  // allocated five styles per row whenever the rows re-rendered (play/pause,
  // track change). Theme-keyed; active/idle title is a precomputed pair.
  const trackStyles = useMemo(() => {
    const accent = MUSIC_TINT(c);
    return StyleSheet.create({
      artTint: { backgroundColor: accent + '22' },
      body: { flex: 1 },
      titleActive: { fontSize: 15, fontWeight: '600', color: accent },
      titleIdle: { fontSize: 15, fontWeight: '600', color: c.textPrimary },
      source: { fontSize: 12, color: c.textTertiary, marginTop: 1 },
      duration: { fontSize: 12, color: c.textTertiary },
    });
  }, [c]);

  const renderTrack = useCallback(({ item }) => {
    // Active is decided by the PLAYING id, not by list position, so the same row
    // highlights correctly in the library and inside a playlist.
    const active = String(item.id) === String(activeTrack?.mediaId);
    return (
      <TouchableOpacity
        {...TAP_ONLY}
        activeOpacity={0.7}
        disabled={!ready}
        onPress={() => playTrack(item)}
        style={styles.row}
      >
        <View style={[styles.art, trackStyles.artTint]}>
          <Icon
            name={active && isPlaying ? 'pause' : 'music-note'}
            size={20}
            color={active ? (MUSIC_TINT(c)) : c.textSecondary}
          />
        </View>
        <View style={trackStyles.body}>
          <Text style={active ? trackStyles.titleActive : trackStyles.titleIdle} numberOfLines={1}>
            {titleOf(item)}
          </Text>
          <Text style={trackStyles.source} numberOfLines={1}>
            {sourceOf(item) || 'Audio'}
          </Text>
        </View>
        {item.duration ? <Text style={trackStyles.duration}>{fmtTime(item.duration)}</Text> : null}
        {/* Per-track options. Its own touchable so it doesn't start playback —
            hitSlop widens the 24pt glyph to a comfortable target without
            stealing the row's tap area. */}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`Options for ${titleOf(item)}`}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 8 }}
          onPress={() => setSheetId(String(item.id))}
          style={styles.moreBtn}
        >
          <Icon name="dots-horizontal" size={22} color={c.textTertiary} />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  }, [c, trackStyles, activeTrack, isPlaying, playTrack, ready]);

  // The "Playlists" row, pinned as the list's first item. A destination, not a
  // track — same row metrics so it reads as part of the list, with a chevron
  // marking it as a push rather than a play.
  const playlistsRow = useCallback(() => (
    <TouchableOpacity
      {...TAP_ONLY}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Playlists, ${playlists.length}`}
      onPress={() => { tapHaptic(); setPlaylistsOpen(true); }}
      style={styles.row}
    >
      <View style={[styles.art, trackStyles.artTint]}>
        <Icon name="playlist-music" size={22} color={MUSIC_TINT(c)} />
      </View>
      <View style={trackStyles.body}>
        <Text style={trackStyles.titleIdle} numberOfLines={1}>Playlists</Text>
        <Text style={trackStyles.source} numberOfLines={1}>
          {playlists.length === 0
            ? 'None yet — add a track from its ⋯ menu'
            : `${playlists.length} playlist${playlists.length === 1 ? '' : 's'}`}
        </Text>
      </View>
      <Icon name="chevron-right" size={22} color={c.textTertiary} />
    </TouchableOpacity>
  ), [c, trackStyles, playlists.length]);

  const renderPlaylistRow = useCallback(({ item }) => {
    const count = playlistIndex.get(item)?.length || 0;
    return (
      <TouchableOpacity
        {...TAP_ONLY}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${item}, ${count} track${count === 1 ? '' : 's'}`}
        onPress={() => { tapHaptic(); setOpenPlaylist(item); }}
        style={styles.row}
      >
        <View style={[styles.art, trackStyles.artTint]}>
          <Icon name="playlist-music" size={22} color={MUSIC_TINT(c)} />
        </View>
        <View style={trackStyles.body}>
          <Text style={trackStyles.titleIdle} numberOfLines={1}>{item}</Text>
          <Text style={trackStyles.source} numberOfLines={1}>
            {count} track{count === 1 ? '' : 's'}
          </Text>
        </View>
        <Icon name="chevron-right" size={22} color={c.textTertiary} />
      </TouchableOpacity>
    );
  }, [c, trackStyles, playlistIndex]);

  return (
    <View style={{ flex: 1, backgroundColor: c.background, paddingTop: topInset }}>
      {onClose ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: insets.top + 6, paddingBottom: 8, paddingHorizontal: 10 }}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="Back">
            <Icon name="chevron-left" size={28} color={c.textPrimary} />
          </TouchableOpacity>
          <Text style={{ fontSize: 22, color: c.textPrimary }}>
            <Text style={{ fontWeight: '100' }}>Music </Text>
            <Text style={{ fontWeight: '400' }}>Vault</Text>
          </Text>
        </View>
      ) : null}

      {error ? (
        <View style={[styles.error, { borderColor: c.border, backgroundColor: c.surfaceElevated }]}>
          <Text style={{ color: c.textSecondary }}>{error}</Text>
          {setupError ? (
            <TouchableOpacity
              accessibilityRole="button"
              onPress={retrySetup}
              style={{ marginTop: 8, alignSelf: 'flex-start' }}
            >
              <Text style={{ color: MUSIC_TINT(c), fontWeight: '700' }}>
                Retry player
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {loading && visibleTracks.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={c.textSecondary} />
        </View>
      ) : visibleTracks.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <Icon name="music-off" size={40} color={c.textTertiary} />
          <Text style={{ color: c.textSecondary, marginTop: 12, textAlign: 'center' }}>
            No music yet. Share a track (SoundCloud etc.) to the Download board and it lands here.
          </Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={visibleTracks}
          keyExtractor={(t) => String(t.id)}
          renderItem={renderTrack}
          onScroll={handleMusicScroll}
          scrollEventThrottle={16}
          ListHeaderComponent={playlistsRow}
          extraData={`${current}:${isPlaying}:${ready}:${playlists.length}`}
          // With a track loaded, reserve the transport bar's real height plus a
          // gap so the last row rests clear of it rather than under it. Falls
          // back to a sane estimate for the single frame before onLayout lands.
          contentContainerStyle={{
            paddingBottom: nowTrack
              ? (nowBarH || 150) + 16
              : Math.max(insets.bottom, bottomInset) + 24,
          }}
          ItemSeparatorComponent={() => <View style={styles.trackSep} />}
        />
      )}

      {/* The transport (play/pause, skip, scrub) is PINNED, so it must end
          above the floating tab bar — `bottomInset` carries that height from
          the vault. Falls back to the safe-area inset when there's no bar. */}
      {nowTrack && (
        <View
          onLayout={(e) => {
            const h = Math.round(e.nativeEvent.layout.height);
            setNowBarH((prev) => (prev === h ? prev : h));
          }}
          style={[styles.nowBar, { backgroundColor: c.surfaceElevated, borderTopColor: c.border, paddingBottom: Math.max(insets.bottom, bottomInset) + 8 }]}
        >
          <Pressable
            disabled={!ready}
            onLayout={(e) => { barWidthRef.current = e.nativeEvent.layout.width || 1; }}
            onPress={(e) => seekFromFraction(e.nativeEvent.locationX / barWidthRef.current)}
            style={styles.seekHit}
          >
            <View style={[styles.seekTrack, { backgroundColor: c.border }]}>
              <View style={{ height: '100%', borderRadius: 2, width: `${duration ? Math.min(100, (position / duration) * 100) : 0}%`, backgroundColor: MUSIC_TINT(c) }} />
            </View>
          </Pressable>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, marginTop: 2 }}>
            <Text style={{ fontSize: 11, color: c.textTertiary }}>{fmtTime(position)}</Text>
            <Text style={{ fontSize: 11, color: c.textTertiary }}>{fmtTime(duration)}</Text>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 6, gap: 12 }}>
            <View style={[styles.art, trackStyles.artTint]}>
              <Icon name="music-note" size={20} color={MUSIC_TINT(c)} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: c.textPrimary }} numberOfLines={1}>{titleOf(nowTrack)}</Text>
              <Text style={{ fontSize: 12, color: c.textTertiary }} numberOfLines={1}>{sourceOf(nowTrack) || 'audio'}</Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Previous track"
              onPress={previous}
              disabled={!ready || current <= 0}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Icon name="skip-previous" size={30} color={ready && current > 0 ? c.textPrimary : c.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
              onPress={togglePlayback}
              disabled={!ready}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Icon name={isPlaying ? 'pause-circle' : 'play-circle'} size={44} color={MUSIC_TINT(c)} />
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Next track"
              onPress={next}
              disabled={!ready || current >= visibleTracks.length - 1}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Icon name="skip-next" size={30} color={ready && current < visibleTracks.length - 1 ? c.textPrimary : c.textMuted} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* A–Z scrub rail for the track list — the Music page's own, so the rail
          no longer vanishes when you swipe over from Boards. Bounded by the
          vault header above and the transport bar below, so the thumb can't run
          under either. */}
      {musicScrubEnabled && (
        <TimelineScrubber
          scrollY={musicScrollY}
          maxScroll={musicMaxScroll}
          data={musicScrubData}
          onJump={handleMusicScrubJump}
          inverted={false}
          topInset={topInset + 8}
          bottomInset={(nowBarH || Math.max(insets.bottom, bottomInset)) + 12}
          accent={MUSIC_TINT(c)}
          dark={theme.mode === 'dark'}
        />
      )}

      {/* Playlists, pushed over the library. Level 1 lists the playlists; level
          2 lists one playlist's tracks. A left-edge swipe backs out — from a
          playlist to the playlist list, and from there to all songs — matching
          every other pushed page in the app. */}
      <EdgeSwipePage
        visible={playlistsOpen}
        onClose={closePlaylists}
        // While a playlist is open on top, the parent's back-swipe must not fire
        // underneath it — otherwise one drag would close BOTH levels at once.
        swipeEnabled={!openPlaylist}
      >
        <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top + 6 }}>
          <View style={styles.pageHeader}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Back to all songs"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              onPress={() => { tapHaptic(); closePlaylists(); }}
              style={styles.pageBackBtn}
            >
              <Icon name="chevron-left" size={28} color={c.textPrimary} />
            </TouchableOpacity>
            <Text style={[styles.pageTitle, { color: c.textPrimary }]} numberOfLines={1}>Playlists</Text>
          </View>

          <FlatList
            data={playlists}
            keyExtractor={(name) => name}
            renderItem={renderPlaylistRow}
            contentContainerStyle={{ paddingBottom: (nowBarH || 150) + 16 }}
            ItemSeparatorComponent={() => <View style={styles.trackSep} />}
            ListEmptyComponent={(
              <View style={styles.pageEmpty}>
                <Icon name="playlist-music-outline" size={40} color={c.textTertiary} />
                <Text style={{ color: c.textSecondary, marginTop: 12, textAlign: 'center' }}>
                  No playlists yet. Open a track's ⋯ menu and add it to one.
                </Text>
              </View>
            )}
          />

          {/* One playlist's tracks — its OWN pushed page, nested INSIDE this one
              rather than being a second state of it. That's what makes the
              back-swipe work at this level too: a committed swipe animates the
              page off and calls onClose, so a level that shares its parent's
              page would animate out and then have nothing left to show.
              `overlay` is required for the nesting — iOS won't present a second
              sibling Modal over an open one. */}
          <EdgeSwipePage overlay visible={!!openPlaylist} onClose={() => setOpenPlaylist(null)}>
            <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top + 6 }}>
              <View style={styles.pageHeader}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Back to playlists"
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  onPress={() => { tapHaptic(); setOpenPlaylist(null); }}
                  style={styles.pageBackBtn}
                >
                  <Icon name="chevron-left" size={28} color={c.textPrimary} />
                </TouchableOpacity>
                <Text style={[styles.pageTitle, { color: c.textPrimary }]} numberOfLines={1}>
                  {openPlaylist || ''}
                </Text>
              </View>
              <FlatList
                data={openPlaylistTracks}
                keyExtractor={(t) => String(t.id)}
                renderItem={renderTrack}
                extraData={`${activeTrack?.mediaId}:${isPlaying}:${ready}`}
                contentContainerStyle={{ paddingBottom: (nowBarH || 150) + 16 }}
                ItemSeparatorComponent={() => <View style={styles.trackSep} />}
              />
            </View>
          </EdgeSwipePage>
        </View>
      </EdgeSwipePage>

      {/* Per-track options, as a card that rises from the bottom edge. Rendered
          LAST so it stacks over the list and the transport bar; it's an in-tree
          overlay rather than a Modal because the vault itself can be inside one
          (a second sibling Modal silently never shows on iOS). */}
      <TrackActionsSheet
        visible={!!sheetTrack}
        track={sheetTrack}
        title={sheetTrack ? titleOf(sheetTrack) : ''}
        subtitle={sheetTrack ? (sourceOf(sheetTrack) || 'Audio') : ''}
        isActive={!!sheetTrack && String(sheetTrack.id) === String(activeTrack?.mediaId)}
        isPlaying={isPlaying}
        playlists={playlists}
        currentPlaylists={sheetTrack ? tagsOf(sheetTrack) : []}
        busy={sheetBusy}
        onPlay={sheetPlay}
        onShare={sheetShare}
        onRename={sheetRename}
        onAddToPlaylist={sheetAddToPlaylist}
        onDelete={sheetDelete}
        onClose={closeSheet}
        bottomInset={Math.max(insets.bottom, bottomInset)}
        colors={c}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  // Hairline grey rule, inset EQUALLY on both sides so it sits centred between
  // rows rather than hanging off the artwork's left edge (row padding is 16).
  trackSep: { height: StyleSheet.hairlineWidth, marginHorizontal: 16, backgroundColor: 'rgba(142,142,147,0.4)' },
  moreBtn: { paddingLeft: 2, paddingVertical: 2 },
  pageHeader: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingBottom: 10 },
  pageBackBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  pageTitle: { flex: 1, fontSize: 22, fontWeight: '600' },
  pageEmpty: { alignItems: 'center', justifyContent: 'center', padding: 32, paddingTop: 80 },
  art: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  error: { marginHorizontal: 16, marginBottom: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  nowBar: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8 },
  seekHit: { paddingVertical: 8, paddingHorizontal: 16 },
  seekTrack: { height: 4, borderRadius: 2, overflow: 'hidden' },
});
