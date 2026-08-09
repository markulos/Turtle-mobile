/**
 * AlbumActionsSheet — the board's "⋯" menu (share / rename / delete), as a
 * card that expands up from the bottom edge.
 *
 * Replaces the stock Alert.alert menu this used to be: an OS alert can't carry
 * the board's identity (cover, item count), lands centred over the grid, and on
 * Android silently loses Alert.prompt for the rename. This card is themed, keeps
 * the rename inline as a PAGE inside the same sheet, and clears the floating
 * dock.
 *
 * Rendered as an IN-TREE absolute overlay, deliberately NOT a <Modal>: the vault
 * can itself sit inside one (the chat's vault overlay), and on iOS a second
 * sibling Modal over an open one silently never appears.
 *
 * CHROME RULE: the card is a PINNED surface, so it reserves `bottomInset`
 * (= dockOccupied(insets.bottom) from the caller) — the floating tab dock must
 * never cover a control you cannot scroll out from under it.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Reanimated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { impactHaptic, notifyHaptic, tapHaptic } from '../../../utils/haptics';
import { useSheetDismiss } from '../../../utils/useSheetDismiss';

// Same presentation curve as the music vault's track menu, so every card in
// the app enters with one motion signature.
const SHEET_EASING = Easing.bezier(0.32, 0.72, 0, 1);
const OPEN_MS = 260;
const CLOSE_MS = 200;

const isLiveShare = (s) => !s.revokedAt && !(s.expiresAt && s.expiresAt < Date.now());

/** "just now" / "3h ago" / "Aug 6" — enough to tell live from long-forgotten. */
function whenLabel(ts) {
  if (!ts) return null;
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.floor(mins / 60)}h ago`;
  if (mins < 60 * 24 * 7) return `${Math.floor(mins / 1440)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function AlbumActionsSheet({
  visible,
  albumName,
  subtitle,
  coverUri,
  busy = false,
  api,
  onShare,
  onRename,
  onDelete,
  onClose,
  bottomInset = 0,
  colors,
}) {
  const c = colors;
  const tint = c.accentInfo || c.primary;
  const liveTint = c.accentSuccess || tint;

  // 0 = off-screen below the edge, 1 = resting open. Drives the card slide and
  // the scrim fade together so they can never disagree.
  const anim = useRef(new Animated.Value(0)).current;
  // Live drag offset (points below rest), kept apart from `anim` so a drag
  // never fights the open/close timing. Owned by the shared sheet-dismiss hook,
  // which grabs the pull from anywhere on the card.
  const { panHandlers, dragY: drag } = useSheetDismiss(onClose, visible);

  // The rename field rides the keyboard frame-for-frame. The card already
  // rests on `bottomInset` of dock clearance, so the lift CANCELS exactly that
  // clearance — mixing the two leaves the card floating over the keyboard.
  const keyboard = useAnimatedKeyboard();
  const keyboardLift = useAnimatedStyle(() => {
    'worklet';
    return { transform: [{ translateY: -Math.max(keyboard.height.value - bottomInset, 0) }] };
  });

  // Measured card height drives the slide distance. State, not a ref: the
  // transform is built at render, so a ref would update silently and leave the
  // interpolation stale. Seeded high so the pre-layout first frame is fully
  // off-screen.
  const [cardH, setCardH] = useState(420);
  const [page, setPage] = useState('actions');
  const [draftName, setDraftName] = useState('');
  // Kept mounted through the closing animation so the card slides out.
  const [mounted, setMounted] = useState(visible);

  // Is this board already published? Answered by the same endpoint the share
  // sheet uses, so the row can say "live" BEFORE you open it — otherwise the
  // only way to know a board is public is to go looking.
  const [share, setShare] = useState({ loading: true, live: 0, views: 0, lastViewedAt: null, locked: false });

  useEffect(() => {
    if (!visible || !albumName || !api?.get) return;
    let cancelled = false;
    setShare((s) => ({ ...s, loading: true }));
    (async () => {
      try {
        const res = await api.get(`/album-shares?album=${encodeURIComponent(albumName)}`);
        if (cancelled) return;
        const live = (res?.shares || []).filter(isLiveShare);
        setShare({
          loading: false,
          live: live.length,
          views: live.reduce((n, s) => n + (s.viewCount || 0), 0),
          lastViewedAt: live.reduce((t, s) => Math.max(t, s.lastViewedAt || 0), 0) || null,
          locked: live.length > 0 && live.every((s) => s.hasPassword),
        });
      } catch {
        // A failed lookup must not lie in either direction: fall back to the
        // plain, unhighlighted row rather than claiming anything.
        if (!cancelled) setShare({ loading: false, live: 0, views: 0, lastViewedAt: null, locked: false });
      }
    })();
    return () => { cancelled = true; };
  }, [visible, albumName, api]);

  const isLive = share.live > 0;

  // Slow breathing dot — the one thing on the card that moves, so "live" reads
  // as a state rather than another label.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!isLive || !mounted) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [isLive, mounted]);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setPage('actions');
      setDraftName('');
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

  const translateY = Animated.add(
    anim.interpolate({ inputRange: [0, 1], outputRange: [cardH, 0] }),
    drag,
  );

  // A no-op rename (empty or unchanged) just closes rather than firing a
  // pointless write across every photo carrying the tag.
  const commitRename = useCallback(() => {
    const name = draftName.trim();
    if (!name || name === albumName) {
      onClose?.();
      return;
    }
    impactHaptic('medium');
    onRename?.(name);
  }, [draftName, albumName, onRename, onClose]);

  if (!mounted || !albumName) return null;

  const rowBorder = { borderTopColor: c.border };

  return (
    <View style={[StyleSheet.absoluteFill, styles.layer]} pointerEvents="box-none">
      <Animated.View
        pointerEvents={visible ? 'auto' : 'none'}
        style={[StyleSheet.absoluteFill, styles.scrim, { opacity: anim }]}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityLabel="Close board options"
          onPress={onClose}
        />
      </Animated.View>

      {/* Keyboard-lift anchor. It carries the bottom pin so the card inside
          keeps its own open/drag transform (an RN Animated value and a
          Reanimated style cannot drive the same node). */}
      <Reanimated.View pointerEvents="box-none" style={[styles.cardAnchor, keyboardLift]}>
        {/* The whole card is the pull-down-to-close zone. */}
        <Animated.View
          {...panHandlers}
          onLayout={(e) => {
            const h = Math.round(e.nativeEvent.layout.height);
            if (h <= 0) return;
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
          <View style={styles.grabArea}>
            <View style={[styles.grabber, { backgroundColor: c.border }]} />
          </View>

          {page === 'actions' ? (
            <>
              <View style={styles.headerRow}>
                <View style={[styles.cover, { backgroundColor: c.surfaceHighlight, borderColor: c.border }]}>
                  {coverUri ? (
                    <Image source={{ uri: coverUri }} style={styles.coverImg} />
                  ) : (
                    <Icon name="image-multiple-outline" size={20} color={c.textTertiary} />
                  )}
                </View>
                <View style={styles.headerText}>
                  <Text style={[styles.title, { color: c.textPrimary }]} numberOfLines={1}>
                    {albumName}
                  </Text>
                  {!!subtitle && (
                    <Text style={[styles.subtitle, { color: c.textTertiary }]} numberOfLines={1}>
                      {subtitle}
                    </Text>
                  )}
                </View>
              </View>

              {/* Row + footnote share ONE background. Two stacked fills of the
                  same low-alpha tint used to overlap by the footnote's negative
                  margin, and the doubled alpha drew a green seam across the
                  middle of the highlight. */}
              <View style={isLive ? { backgroundColor: withAlpha(liveTint, '1A') } : null}>
              <ActionRow
                icon={isLive ? (share.locked ? 'lock' : 'web') : 'web'}
                label={isLive ? 'Live on the web' : 'Share to the web'}
                hint={
                  isLive
                    ? [
                        share.live > 1 ? `${share.live} links` : (share.locked ? 'Password link' : 'Public link'),
                        `${share.views} ${share.views === 1 ? 'view' : 'views'}`,
                        share.lastViewedAt ? `last opened ${whenLabel(share.lastViewedAt)}` : 'never opened',
                      ].join(' · ')
                    : 'Public link, no account needed'
                }
                color={isLive ? liveTint : c.textPrimary}
                hintColor={isLive ? c.textSecondary : c.textTertiary}
                style={rowBorder}
                disabled={busy}
                accessibilityLabel={
                  isLive
                    ? `Board is live on the web, ${share.views} views. Manage links and activity`
                    : 'Share to the web'
                }
                right={
                  isLive ? (
                    <View style={[styles.livePill, { backgroundColor: withAlpha(liveTint, '2E') }]}>
                      <Animated.View
                        style={[
                          styles.liveDot,
                          {
                            backgroundColor: liveTint,
                            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.25] }),
                            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.45] }) }],
                          },
                        ]}
                      />
                      <Text style={[styles.livePillText, { color: liveTint }]}>LIVE</Text>
                    </View>
                  ) : null
                }
                onPress={() => {
                  tapHaptic();
                  onShare?.();
                }}
              />
              {isLive && (
                <Text style={[styles.liveFootnote, { color: c.textTertiary }]}>
                  Tap to see who opened it, copy the link, or turn it off.
                </Text>
              )}
              </View>
              <ActionRow
                icon="pencil-outline"
                label="Rename board…"
                color={c.textPrimary}
                hintColor={c.textTertiary}
                style={rowBorder}
                chevron
                onPress={() => {
                  tapHaptic();
                  setDraftName(albumName);
                  setPage('rename');
                }}
              />
              <ActionRow
                icon="trash-can-outline"
                label="Delete board"
                hint="Photos stay in All — only the tag goes"
                color={c.accentError || '#F87171'}
                hintColor={c.textTertiary}
                style={rowBorder}
                disabled={busy}
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
                  accessibilityLabel="Back to board options"
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
                    Rename board
                  </Text>
                  <Text style={[styles.subtitle, { color: c.textTertiary }]} numberOfLines={1}>
                    Every photo tagged “{albumName}” follows the new name.
                  </Text>
                </View>
              </View>

              <View style={[styles.newRow, rowBorder]}>
                <Icon name="pencil-outline" size={20} color={c.textSecondary} />
                <TextInput
                  style={[styles.newInput, { color: c.textPrimary }]}
                  placeholder="Board name"
                  placeholderTextColor={c.textMuted}
                  value={draftName}
                  onChangeText={setDraftName}
                  autoFocus
                  selectTextOnFocus
                  autoCapitalize="none"
                  returnKeyType="done"
                  onSubmitEditing={commitRename}
                />
                {draftName.trim() && draftName.trim() !== albumName ? (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Save board name"
                    onPress={commitRename}
                  >
                    <Text style={[styles.saveText, { color: tint }]}>Save</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </>
          )}
        </Animated.View>
      </Reanimated.View>
    </View>
  );
}

function ActionRow({
  icon, label, hint, color, hintColor, onPress, style, disabled, chevron, right, accessibilityLabel,
}) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      activeOpacity={0.7}
      disabled={disabled}
      onPress={onPress}
      style={[styles.row, style, disabled && styles.rowDisabled]}
    >
      <Icon name={icon} size={20} color={color} />
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color }]} numberOfLines={1}>
          {label}
        </Text>
        {!!hint && (
          <Text style={[styles.rowHint, { color: hintColor }]} numberOfLines={1}>
            {hint}
          </Text>
        )}
      </View>
      {right || null}
      {chevron ? <Icon name="chevron-right" size={20} color={color} /> : null}
    </TouchableOpacity>
  );
}

/**
 * Tint at low alpha for the "live" highlight. The theme's accents are hex, but
 * a custom accent can arrive as rgba() — then return undefined (no fill) rather
 * than a broken 'rgba(...)1A' string, or worse, an opaque wash of the accent.
 */
function withAlpha(color, hexAlpha) {
  return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color + hexAlpha : undefined;
}

const styles = StyleSheet.create({
  // Above the pushed photos page, below the share sheet it opens.
  layer: { zIndex: 55 },
  scrim: { backgroundColor: 'rgba(0,0,0,0.5)' },
  // The bottom pin lives on the ANCHOR (which carries the keyboard lift), not
  // on the card — the card's transform stays free for the open/drag motion.
  cardAnchor: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  card: {
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
  cover: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  coverImg: { width: '100%', height: '100%' },
  title: { fontSize: 15, fontWeight: '700' },
  subtitle: { fontSize: 12, marginTop: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowDisabled: { opacity: 0.55 },
  rowText: { flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: '600' },
  rowHint: { fontSize: 11.5, marginTop: 1 },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  livePillText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  // Hangs under the row's TEXT column (18 padding + 20 icon + 14 gap), so it
  // reads as a continuation of the hint rather than a second, wider block.
  liveFootnote: {
    fontSize: 11,
    lineHeight: 15,
    paddingLeft: 52,
    paddingRight: 18,
    paddingBottom: 12,
    marginTop: -6,
  },
  newRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  // Inline field in an icon row: explicit height + zero vertical padding, or
  // the glyphs ride high against the icon. App-wide rule for inline inputs.
  newInput: {
    flex: 1,
    fontSize: 15,
    height: 34,
    paddingVertical: 0,
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
  saveText: { fontSize: 14, fontWeight: '700' },
});
