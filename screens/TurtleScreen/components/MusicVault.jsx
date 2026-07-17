import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, ActivityIndicator, StyleSheet, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useTheme } from '../../../context/ThemeContext';
import { useServer } from '../../../context/ServerContext';
import { tapHaptic, impactHaptic } from '../../../utils/haptics';

// A lightweight music player over the vault's kind=audio slice (sound files
// shared / ghost-downloaded from SoundCloud etc.). expo-video's player plays
// audio-only sources; a 0-size VideoView keeps the native player attached.
// In-app playback only for now — background + lock-screen controls need a
// dev-client rebuild (react-native-track-player), a later phase.

const fmtTime = (sec) => {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};

// Strip a file extension + tidy an audio row's display title.
const titleOf = (item) => {
  const raw = item.originalName || item.filename || 'Unknown track';
  return String(raw).replace(/\.[a-z0-9]{2,5}$/i, '').trim() || 'Unknown track';
};
const sourceOf = (item) => {
  const u = item.sourceUrl || item.originalPath || '';
  try { return u ? new URL(u).hostname.replace(/^www\./, '') : ''; } catch { return ''; }
};

export default function MusicVault({ onClose }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const insets = useSafeAreaInsets();
  const { api, getBaseUrl, getMediaBaseUrl } = useServer();
  const mediaBase = (getMediaBaseUrl ? getMediaBaseUrl() : getBaseUrl()).replace(/\/api$/, '');
  const fullUrl = useCallback((p) => (!p ? null : (/^https?:/i.test(p) ? p : mediaBase + p)), [mediaBase]);

  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState(null); // index into tracks
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const barWidthRef = useRef(1);

  // Single player instance; swap sources via player.replace().
  const player = useVideoPlayer(null, (p) => {
    p.timeUpdateEventInterval = 0.4;
    p.loop = false;
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/media/gallery?kind=audio&limit=300&order=desc&sortBy=upload');
      setTracks(Array.isArray(r?.items) ? r.items : []);
    } catch {
      setTracks([]);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  // Player event wiring — position, duration, play-state, auto-advance.
  const currentRef = useRef(current);
  currentRef.current = current;
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const playIndex = useCallback((idx) => {
    const list = tracksRef.current;
    if (idx == null || idx < 0 || idx >= list.length) return;
    const uri = fullUrl(list[idx].rawUrl || list[idx].url);
    if (!uri) return;
    setCurrent(idx);
    setPosition(0);
    try {
      player.replace({ uri });
      player.play();
    } catch { /* ignore */ }
  }, [fullUrl, player]);

  useEffect(() => {
    if (!player) return undefined;
    const subs = [];
    try {
      subs.push(player.addListener('timeUpdate', (p) => {
        if (typeof p?.currentTime === 'number') setPosition(p.currentTime);
        if (typeof player.duration === 'number' && player.duration > 0) setDuration(player.duration);
      }));
      subs.push(player.addListener('playingChange', (p) => {
        setPlaying(!!(p?.isPlaying ?? player.playing));
      }));
      subs.push(player.addListener('statusChange', () => {
        if (typeof player.duration === 'number' && player.duration > 0) setDuration(player.duration);
      }));
      // Auto-advance to the next track at end.
      subs.push(player.addListener('playToEnd', () => {
        const next = (currentRef.current ?? -1) + 1;
        if (next < tracksRef.current.length) playIndex(next);
        else setPlaying(false);
      }));
    } catch { /* older expo-video event set — degrade gracefully */ }
    return () => { for (const s of subs) { try { s.remove(); } catch { /* ignore */ } } };
  }, [player, playIndex]);

  const togglePlay = useCallback(() => {
    if (current == null) { playIndex(0); return; }
    try {
      if (player.playing) player.pause();
      else player.play();
    } catch { /* ignore */ }
  }, [current, player, playIndex]);

  const seekTo = useCallback((frac) => {
    if (!duration) return;
    const t = Math.max(0, Math.min(duration, frac * duration));
    try { player.currentTime = t; setPosition(t); } catch { /* ignore */ }
  }, [duration, player]);

  const renderTrack = useCallback(({ item, index }) => {
    const active = index === current;
    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPressIn={() => tapHaptic()}
        onPress={() => playIndex(index)}
        style={styles.row}
      >
        <View style={[styles.art, { backgroundColor: (c.accentSuccess || '#4ADE80') + '22' }]}>
          <Icon
            name={active && playing ? 'pause' : 'music-note'}
            size={20}
            color={active ? (c.accentSuccess || '#4ADE80') : c.textSecondary}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: active ? (c.accentSuccess || '#4ADE80') : c.textPrimary }} numberOfLines={1}>
            {titleOf(item)}
          </Text>
          <Text style={{ fontSize: 12, color: c.textTertiary, marginTop: 1 }} numberOfLines={1}>
            {sourceOf(item) || 'Audio'}
          </Text>
        </View>
        {item.duration ? <Text style={{ fontSize: 12, color: c.textTertiary }}>{fmtTime(item.duration)}</Text> : null}
      </TouchableOpacity>
    );
  }, [c, current, playing, playIndex]);

  const nowTrack = current != null ? tracks[current] : null;

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      {/* Hidden player surface — keeps the native audio player attached. */}
      <VideoView player={player} style={styles.hiddenPlayer} pointerEvents="none" />

      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: insets.top + 6, paddingBottom: 8, paddingHorizontal: 10 }}>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="Back">
          <Icon name="chevron-left" size={28} color={c.textPrimary} />
        </TouchableOpacity>
        <Text style={{ fontSize: 22, color: c.textPrimary }}>
          <Text style={{ fontWeight: '100' }}>Music </Text>
          <Text style={{ fontWeight: '400' }}>Vault</Text>
        </Text>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={c.textSecondary} />
        </View>
      ) : tracks.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <Icon name="music-off" size={40} color={c.textTertiary} />
          <Text style={{ color: c.textSecondary, marginTop: 12, textAlign: 'center' }}>
            No music yet. Share a track (SoundCloud etc.) to the Download board and it lands here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={tracks}
          keyExtractor={(t) => String(t.id)}
          renderItem={renderTrack}
          extraData={`${current}:${playing}`}
          contentContainerStyle={{ paddingBottom: nowTrack ? 150 : insets.bottom + 24 }}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: c.border, marginLeft: 68 }} />}
        />
      )}

      {/* Now-playing bar */}
      {nowTrack && (
        <View style={[styles.nowBar, { backgroundColor: c.surfaceElevated, borderTopColor: c.border, paddingBottom: insets.bottom + 8 }]}>
          {/* Seek bar (tap to scrub) */}
          <Pressable
            onLayout={(e) => { barWidthRef.current = e.nativeEvent.layout.width || 1; }}
            onPress={(e) => seekTo(e.nativeEvent.locationX / barWidthRef.current)}
            style={styles.seekHit}
          >
            <View style={[styles.seekTrack, { backgroundColor: c.border }]}>
              <View style={{ height: '100%', borderRadius: 2, width: `${duration ? Math.min(100, (position / duration) * 100) : 0}%`, backgroundColor: c.accentSuccess || '#4ADE80' }} />
            </View>
          </Pressable>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, marginTop: 2 }}>
            <Text style={{ fontSize: 11, color: c.textTertiary }}>{fmtTime(position)}</Text>
            <Text style={{ fontSize: 11, color: c.textTertiary }}>{fmtTime(duration)}</Text>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 6, gap: 12 }}>
            <View style={[styles.art, { backgroundColor: (c.accentSuccess || '#4ADE80') + '22' }]}>
              <Icon name="music-note" size={20} color={c.accentSuccess || '#4ADE80'} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: c.textPrimary }} numberOfLines={1}>{titleOf(nowTrack)}</Text>
              <Text style={{ fontSize: 12, color: c.textTertiary }} numberOfLines={1}>{sourceOf(nowTrack) || 'audio'}</Text>
            </View>
            <TouchableOpacity onPress={() => { impactHaptic('light'); if (current > 0) playIndex(current - 1); }} disabled={current <= 0} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Icon name="skip-previous" size={30} color={current > 0 ? c.textPrimary : c.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { impactHaptic('medium'); togglePlay(); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Icon name={playing ? 'pause-circle' : 'play-circle'} size={44} color={c.accentSuccess || '#4ADE80'} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { impactHaptic('light'); if (current < tracks.length - 1) playIndex(current + 1); }} disabled={current >= tracks.length - 1} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Icon name="skip-next" size={30} color={current < tracks.length - 1 ? c.textPrimary : c.textMuted} />
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  hiddenPlayer: { width: 0, height: 0, position: 'absolute', opacity: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  art: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  nowBar: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8 },
  seekHit: { paddingVertical: 8, paddingHorizontal: 16 },
  seekTrack: { height: 4, borderRadius: 2, overflow: 'hidden' },
});
