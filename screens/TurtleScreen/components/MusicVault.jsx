import React, { useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, ActivityIndicator, StyleSheet, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../../../context/ThemeContext';
import { useMusicPlayer } from '../../../context/MusicPlayerContext';
import { titleOf, sourceOf } from '../../../services/musicTrackMapper';
import { tapHaptic, impactHaptic } from '../../../utils/haptics';

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
export default function MusicVault({ onClose, topInset = 0 }) {
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
  const current = tracks.findIndex(
    (item) => String(item.id) === String(activeTrack?.mediaId)
  );
  const nowTrack = current >= 0 ? tracks[current] : null;
  const barWidthRef = useRef(1);

  useFocusEffect(
    useCallback(() => {
      refreshLibrary();
    }, [refreshLibrary])
  );

  const playIndex = useCallback(
    (index) => {
      const item = tracks[index];
      if (item?.id != null) playMedia(String(item.id));
    },
    [playMedia, tracks]
  );

  const seekFromFraction = useCallback(
    (fraction) => {
      if (!duration) return;
      seekTo(Math.max(0, Math.min(duration, fraction * duration)));
    },
    [duration, seekTo]
  );

  const renderTrack = useCallback(({ item, index }) => {
    const active = index === current;
    return (
      <TouchableOpacity
        activeOpacity={0.7}
        disabled={!ready}
        onPressIn={() => tapHaptic()}
        onPress={() => playIndex(index)}
        style={styles.row}
      >
        <View style={[styles.art, { backgroundColor: (c.accentSuccess || '#4ADE80') + '22' }]}>
          <Icon
            name={active && isPlaying ? 'pause' : 'music-note'}
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
  }, [c, current, isPlaying, playIndex, ready]);

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
              <Text style={{ color: c.accentSuccess || '#4ADE80', fontWeight: '700' }}>
                Retry player
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {loading && tracks.length === 0 ? (
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
          extraData={`${current}:${isPlaying}:${ready}`}
          contentContainerStyle={{ paddingBottom: nowTrack ? 150 : insets.bottom + 24 }}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: c.border, marginLeft: 68 }} />}
        />
      )}

      {nowTrack && (
        <View style={[styles.nowBar, { backgroundColor: c.surfaceElevated, borderTopColor: c.border, paddingBottom: insets.bottom + 8 }]}>
          <Pressable
            disabled={!ready}
            onLayout={(e) => { barWidthRef.current = e.nativeEvent.layout.width || 1; }}
            onPress={(e) => seekFromFraction(e.nativeEvent.locationX / barWidthRef.current)}
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
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Previous track"
              onPress={() => {
                impactHaptic('light');
                previous();
              }}
              disabled={!ready || current <= 0}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Icon name="skip-previous" size={30} color={ready && current > 0 ? c.textPrimary : c.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
              onPress={() => {
                impactHaptic('medium');
                togglePlayback();
              }}
              disabled={!ready}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Icon name={isPlaying ? 'pause-circle' : 'play-circle'} size={44} color={c.accentSuccess || '#4ADE80'} />
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Next track"
              onPress={() => {
                impactHaptic('light');
                next();
              }}
              disabled={!ready || current >= tracks.length - 1}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Icon name="skip-next" size={30} color={ready && current < tracks.length - 1 ? c.textPrimary : c.textMuted} />
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  art: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  error: { marginHorizontal: 16, marginBottom: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  nowBar: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8 },
  seekHit: { paddingVertical: 8, paddingHorizontal: 16 },
  seekTrack: { height: 4, borderRadius: 2, overflow: 'hidden' },
});
