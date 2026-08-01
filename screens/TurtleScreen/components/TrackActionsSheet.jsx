import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { impactHaptic, notifyHaptic, tapHaptic } from '../../../utils/haptics';

// Sheet-presentation curve — the same weighted ease-out the vault's other
// bottom-anchored surfaces use, so this card enters like the rest of the app.
const SHEET_EASING = Easing.bezier(0.32, 0.72, 0, 1);
const OPEN_MS = 260;
const CLOSE_MS = 200;

/**
 * TrackActionsSheet — the per-track "⋯" menu in the Music vault, as a card that
 * expands up from the bottom edge.
 *
 * Rendered as an IN-TREE absolute overlay, deliberately NOT a <Modal>: the vault
 * can itself be presented inside a Modal (the chat's vault overlay), and on iOS a
 * second sibling Modal over an open one silently never appears. An overlay inside
 * the page has no such failure mode and animates the same.
 *
 * Two pages inside one card:
 *   1. actions — play/pause, share, add to playlist, delete
 *   2. playlists — pick an existing playlist or type a new one
 * The playlist picker is a PAGE, not a second sheet, for the same iOS reason.
 */
export default function TrackActionsSheet({
  visible,
  track,
  title,
  subtitle,
  isActive = false,
  isPlaying = false,
  playlists = [],
  currentPlaylists = [],
  busy = false,
  onPlay,
  onShare,
  onAddToPlaylist,
  onDelete,
  onClose,
  bottomInset = 0,
  colors,
}) {
  const c = colors;
  // Same highlight tint the player itself uses (MusicVault's MUSIC_TINT): the
  // user's chosen accent, not a fixed green.
  const tint = c.accent || c.accentInfo || c.primary;
  // 0 = fully off-screen (below the edge), 1 = resting open. Drives both the
  // card's slide and the scrim's fade so they can never disagree.
  const anim = useRef(new Animated.Value(0)).current;
  // Live drag offset, in points below the resting position. Kept separate from
  // `anim` so a drag doesn't fight the open/close timing.
  const drag = useRef(new Animated.Value(0)).current;
  // Measured card height, driving BOTH the slide distance and the drag-dismiss
  // threshold. State (not just a ref) because the transform is built at render:
  // a ref would update silently and leave the interpolation stale. Seeded high
  // enough that the pre-layout first frame is always fully off-screen — a low
  // seed would let the card peek above the edge before it was measured.
  const [cardH, setCardH] = useState(600);
  const cardHeight = useRef(600);
  const [page, setPage] = useState('actions');
  const [newPlaylist, setNewPlaylist] = useState('');
  // Kept mounted through the closing animation so the card slides out instead
  // of vanishing; unmounts once it's off-screen.
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setPage('actions');
      setNewPlaylist('');
      drag.setValue(0);
      Animated.timing(anim, {
        toValue: 1,
        duration: OPEN_MS,
        easing: SHEET_EASING,
        useNativeDriver: true,
      }).start();
    } else if (mounted) {
      Animated.timing(anim, {
        toValue: 0,
        duration: CLOSE_MS,
        easing: SHEET_EASING,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible]);

  // Drag-down-to-dismiss on the card's grabber area. Follows the finger, then
  // either snaps back or hands off to onClose past a third of the card.
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => g.dy > 4 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_e, g) => {
          if (g.dy > 0) drag.setValue(g.dy);
        },
        onPanResponderRelease: (_e, g) => {
          const far = g.dy > cardHeight.current / 3 || g.vy > 0.7;
          if (far) {
            onClose?.();
            return;
          }
          Animated.spring(drag, {
            toValue: 0,
            useNativeDriver: true,
            damping: 22,
            stiffness: 220,
            mass: 0.7,
          }).start();
        },
      }),
    [onClose],
  );

  const translateY = Animated.add(
    anim.interpolate({ inputRange: [0, 1], outputRange: [cardH, 0] }),
    drag,
  );

  const run = useCallback(
    (fn) => () => {
      tapHaptic();
      fn?.();
    },
    [],
  );

  if (!mounted || !track) return null;

  const rowBorder = { borderTopColor: c.border };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View
        pointerEvents={visible ? 'auto' : 'none'}
        style={[StyleSheet.absoluteFill, styles.scrim, { opacity: anim }]}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityLabel="Close track options"
          onPress={onClose}
        />
      </Animated.View>

      <Animated.View
        testID="track-actions-card"
        onLayout={(e) => {
          const h = Math.round(e.nativeEvent.layout.height);
          if (h <= 0) return;
          cardHeight.current = h;
          setCardH((prev) => (prev === h ? prev : h));
        }}
        style={[
          styles.card,
          {
            backgroundColor: c.surfaceElevated,
            borderColor: c.border,
            paddingBottom: bottomInset + 10,
            transform: [{ translateY }],
          },
        ]}
      >
        <View {...pan.panHandlers} style={styles.grabArea}>
          <View style={[styles.grabber, { backgroundColor: c.border }]} />
        </View>

        {page === 'actions' ? (
          <>
            <View style={styles.headerRow}>
              <View style={[styles.art, { backgroundColor: tint + '22' }]}>
                <Icon name="music-note" size={20} color={tint} />
              </View>
              <View style={styles.headerText}>
                <Text style={[styles.title, { color: c.textPrimary }]} numberOfLines={1}>
                  {title}
                </Text>
                <Text style={[styles.subtitle, { color: c.textTertiary }]} numberOfLines={1}>
                  {subtitle}
                </Text>
              </View>
            </View>

            <ActionRow
              icon={isActive && isPlaying ? 'pause' : 'play'}
              label={isActive && isPlaying ? 'Pause' : 'Play'}
              color={c.textPrimary}
              style={rowBorder}
              onPress={run(onPlay)}
            />
            <ActionRow
              icon="share-variant"
              label="Share"
              color={c.textPrimary}
              style={rowBorder}
              disabled={busy}
              onPress={run(onShare)}
            />
            <ActionRow
              icon="playlist-plus"
              label="Add to playlist"
              color={c.textPrimary}
              style={rowBorder}
              chevron
              onPress={() => {
                tapHaptic();
                setPage('playlists');
              }}
            />
            <ActionRow
              icon="trash-can-outline"
              label="Delete from vault"
              color={c.accentError || '#F87171'}
              style={rowBorder}
              onPress={() => {
                notifyHaptic('warning');
                onDelete?.();
              }}
            />
          </>
        ) : (
          <>
            <View style={styles.headerRow}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Back to track options"
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                onPress={() => {
                  tapHaptic();
                  setPage('actions');
                }}
              >
                <Icon name="chevron-left" size={26} color={c.textPrimary} />
              </TouchableOpacity>
              <View style={styles.headerText}>
                <Text style={[styles.title, { color: c.textPrimary }]} numberOfLines={1}>
                  Add to playlist
                </Text>
                <Text style={[styles.subtitle, { color: c.textTertiary }]} numberOfLines={1}>
                  {title}
                </Text>
              </View>
            </View>

            <View style={[styles.newRow, rowBorder]}>
              <Icon name="plus" size={20} color={c.textSecondary} />
              <TextInput
                style={[styles.newInput, { color: c.textPrimary }]}
                placeholder="New playlist…"
                placeholderTextColor={c.textMuted}
                value={newPlaylist}
                onChangeText={setNewPlaylist}
                returnKeyType="done"
                onSubmitEditing={() => {
                  const name = newPlaylist.trim();
                  if (!name) return;
                  impactHaptic('medium');
                  onAddToPlaylist?.(name);
                }}
              />
              {newPlaylist.trim() ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={`Create playlist ${newPlaylist.trim()}`}
                  onPress={() => {
                    impactHaptic('medium');
                    onAddToPlaylist?.(newPlaylist.trim());
                  }}
                >
                  <Text style={[styles.createText, { color: tint }]}>Create</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Bounded so a long playlist list can't grow the card past the
                screen — it scrolls inside the card instead. */}
            <ScrollView style={styles.playlistScroll} keyboardShouldPersistTaps="handled">
              {playlists.length === 0 ? (
                <Text style={[styles.empty, { color: c.textTertiary }]}>
                  No playlists yet — type a name above to make the first one.
                </Text>
              ) : (
                playlists.map((name) => {
                  const already = currentPlaylists.includes(name);
                  return (
                    <ActionRow
                      key={name}
                      icon={already ? 'check' : 'playlist-music'}
                      label={name}
                      color={already ? (tint) : c.textPrimary}
                      style={rowBorder}
                      disabled={already}
                      onPress={() => {
                        impactHaptic('medium');
                        onAddToPlaylist?.(name);
                      }}
                    />
                  );
                })
              )}
            </ScrollView>
          </>
        )}
      </Animated.View>
    </View>
  );
}

function ActionRow({ icon, label, color, onPress, style, disabled, chevron }) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      activeOpacity={0.7}
      disabled={disabled}
      onPress={onPress}
      style={[styles.row, style, disabled && styles.rowDisabled]}
    >
      <Icon name={icon} size={20} color={color} />
      <Text style={[styles.rowLabel, { color }]} numberOfLines={1}>
        {label}
      </Text>
      {chevron ? <Icon name="chevron-right" size={20} color={color} /> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(0,0,0,0.5)' },
  card: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  grabArea: { alignItems: 'center', paddingTop: 8, paddingBottom: 6 },
  grabber: { width: 38, height: 4, borderRadius: 2 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 12 },
  headerText: { flex: 1 },
  art: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 15, fontWeight: '700' },
  subtitle: { fontSize: 12, marginTop: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowDisabled: { opacity: 0.55 },
  rowLabel: { flex: 1, fontSize: 15, fontWeight: '600' },
  newRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  newInput: { flex: 1, fontSize: 15, paddingVertical: 6 },
  createText: { fontSize: 14, fontWeight: '700' },
  playlistScroll: { maxHeight: 260 },
  empty: { fontSize: 13, paddingHorizontal: 18, paddingVertical: 18, lineHeight: 18 },
});
