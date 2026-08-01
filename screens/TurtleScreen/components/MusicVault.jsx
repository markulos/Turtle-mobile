import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, ActivityIndicator, StyleSheet, Pressable, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../../../context/ThemeContext';
import { useMusicPlayer } from '../../../context/MusicPlayerContext';
import { useServer } from '../../../context/ServerContext';
import { titleOf, sourceOf, resolveMediaUrl } from '../../../services/musicTrackMapper';
import { TAP_ONLY } from '../../../utils/pressBehavior';
import TrackActionsSheet from './TrackActionsSheet';

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
  const visibleTracks = useMemo(
    () => (removedIds.size ? tracks.filter((t) => !removedIds.has(String(t.id))) : tracks),
    [tracks, removedIds]
  );
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

  // Playlists are derived from the AUDIO library's own tags, not the global
  // album list — so the picker offers music playlists rather than every photo
  // board in the vault. No extra request: the rows already carry their tags.
  const playlists = useMemo(() => {
    const names = new Set();
    for (const t of tracks) for (const tag of tagsOf(t)) names.add(tag);
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [tracks]);

  useFocusEffect(
    useCallback(() => {
      refreshLibrary();
    }, [refreshLibrary])
  );

  const playIndex = useCallback(
    (index) => {
      const item = visibleTracks[index];
      if (item?.id != null) playMedia(String(item.id));
    },
    [playMedia, visibleTracks]
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

  // Playlists are tags, and the tags endpoint REPLACES the list — so send the
  // union of what the row already has plus the new name. Closes immediately and
  // persists in the background; a failure surfaces as an alert and a refresh
  // puts the true state back.
  const sheetAddToPlaylist = useCallback(
    (name) => {
      const item = sheetTrack;
      const clean = String(name || '').trim();
      if (!item || !clean) return;
      closeSheet();
      const next = Array.from(new Set([...tagsOf(item), clean]));
      api.put(`/media/${item.id}/tags`, { tags: next })
        .then(() => refreshLibrary())
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
            // Optimistic: hide it now, un-hide only if the server refuses.
            setRemovedIds((prev) => new Set(prev).add(id));
            api.delete(`/media/${id}`)
              .then(() => refreshLibrary())
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

  const renderTrack = useCallback(({ item, index }) => {
    const active = index === current;
    return (
      <TouchableOpacity
        {...TAP_ONLY}
        activeOpacity={0.7}
        disabled={!ready}
        onPress={() => playIndex(index)}
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
  }, [c, trackStyles, current, isPlaying, playIndex, ready]);

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
          data={visibleTracks}
          keyExtractor={(t) => String(t.id)}
          renderItem={renderTrack}
          extraData={`${current}:${isPlaying}:${ready}`}
          // With a track loaded, reserve the transport bar's real height plus a
          // gap so the last row rests clear of it rather than under it. Falls
          // back to a sane estimate for the single frame before onLayout lands.
          contentContainerStyle={{
            paddingBottom: nowTrack
              ? (nowBarH || 150) + 16
              : Math.max(insets.bottom, bottomInset) + 24,
          }}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: c.border, marginLeft: 68 }} />}
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
  moreBtn: { paddingLeft: 2, paddingVertical: 2 },
  art: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  error: { marginHorizontal: 16, marginBottom: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  nowBar: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8 },
  seekHit: { paddingVertical: 8, paddingHorizontal: 16 },
  seekTrack: { height: 4, borderRadius: 2, overflow: 'hidden' },
});
