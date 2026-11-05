import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import AppTextInput from '../../../components/AppTextInput';
import Reanimated, {
  useAnimatedKeyboard,
  useAnimatedStyle,
} from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { impactHaptic, notifyHaptic, tapHaptic } from '../../../utils/haptics';
import { useSheetDismiss } from '../../../utils/useSheetDismiss';
import { usePondAccess } from '../../../utils/usePondAccess';
import AnimalAvatar from '../../../components/AnimalAvatar';
import { resolveAvatarUrl } from '../../../utils/avatarUrl';
import { INPUT_FIELD } from '../../../utils/inputField';
import { Image } from 'expo-image';
import { SCROLL_INDICATOR } from '../../../utils/scrollIndicator';

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
 * Three pages inside one card:
 *   1. actions — play/pause, share, rename, add to playlist, delete
 *   2. rename — edit the track's title in place
 *   3. playlists — pick an existing playlist or type a new one
 * Both sub-pages are PAGES, not second sheets, for the same iOS reason.
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
  // 'none' | 'running' | 'done' — what this track's transcript situation is,
  // so the row can say what the tap will actually do instead of offering
  // "Transcribe" for something already being transcribed.
  transcriptState = 'none',
  onPlay,
  onShare,
  onRename,
  onAddToPlaylist,
  /** () => void — file this track into the Voice recordings folder, or take it
   *  back out. `isRecording` says which way it goes. Optional: a surface that
   *  cannot file (a track someone else shared) simply omits it. */
  onToggleRecording,
  isRecording = false,
  onTranscribe,
  /** () => void — keep this track's bytes on the phone, or give them back.
   *  `offlineState` says which way it goes. Optional: a surface that cannot
   *  download (a test, the share target) simply omits it. */
  onToggleOffline,
  /** 'absent' | 'downloading' | 'done' | 'failed' */
  offlineState = 'absent',
  /** 0..1, only meaningful while downloading. */
  offlineProgress = 0,
  onDelete,
  onClose,
  bottomInset = 0,
  colors,
  // Giving this ONE track to someone in the pond — the fourth page. `api` is
  // what switches it on: a surface with no client (a test, the share target)
  // simply doesn't get the row.
  api,
  baseUrl,
  onPondChanged,
}) {
  const c = colors;
  // Same highlight tint the player itself uses (MusicVault's MUSIC_TINT): the
  // user's chosen accent, not a fixed green.
  const tint = c.accent || c.accentInfo || c.primary;
  // 0 = fully off-screen (below the edge), 1 = resting open. Drives both the
  // card's slide and the scrim's fade so they can never disagree.
  const anim = useRef(new Animated.Value(0)).current;
  // Live drag offset, in points below the resting position. Kept separate from
  // `anim` so a drag doesn't fight the open/close timing. Owned by the shared
  // sheet-dismiss hook, which grabs the pull from anywhere on the card and
  // stands down while the playlist list below is scrolled.
  const { panHandlers, dragY: drag, scrollProps } = useSheetDismiss(onClose, visible);

  // Keyboard lift for the "New playlist…" field — the SAME technique as the
  // Turtle chat composer: one useAnimatedKeyboard shared value driving a
  // translateY on the UI thread, so the card rides the keyboard frame-for-frame
  // instead of being covered by it (or jumping to meet it a beat late, which is
  // what a KeyboardAvoidingView here would do).
  //
  // It rides a WRAPPER, not the card: the card's own transform belongs to the
  // RN Animated open/drag, and an RN Animated value and a Reanimated style
  // can't drive the same node.
  //
  // The card is bottom-pinned and already reserves `bottomInset` of clearance
  // over the dock, so — exactly like the composer's `keyboardHeight − dockH` —
  // the lift cancels that resting clearance and leaves the card sitting on the
  // keyboard's top edge.
  const keyboard = useAnimatedKeyboard();
  const keyboardLift = useAnimatedStyle(() => {
    'worklet';
    return { transform: [{ translateY: -Math.max(keyboard.height.value - bottomInset, 0) }] };
  });
  // Measured card height, driving BOTH the slide distance and the drag-dismiss
  // threshold. State (not just a ref) because the transform is built at render:
  // a ref would update silently and leave the interpolation stale. Seeded high
  // enough that the pre-layout first frame is always fully off-screen — a low
  // seed would let the card peek above the edge before it was measured.
  const [cardH, setCardH] = useState(600);
  const [page, setPage] = useState('actions');
  const [newPlaylist, setNewPlaylist] = useState('');
  // Draft title for the rename page. Seeded from `title` each time that page is
  // opened (not on every render) so typing isn't clobbered by a library refresh.
  const [draftTitle, setDraftTitle] = useState('');
  // Kept mounted through the closing animation so the card slides out instead
  // of vanishing; unmounts once it's off-screen.
  const [mounted, setMounted] = useState(visible);

  // Who in the pond has this track. The SAME exchange a photo board's sharing
  // card holds (utils/usePondAccess) — the rendering differs, the rules must
  // not. Read while the sheet is open and this track is a real row; a shut
  // sheet holds no subscription to the pond directory.
  const pond = usePondAccess(api, {
    kind: 'track',
    id: track?.id,
    enabled: !!api && visible && !!track?.id,
    onChanged: onPondChanged,
  });

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setPage('actions');
      setNewPlaylist('');
      setDraftTitle('');
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

  const run = useCallback(
    (fn) => () => {
      tapHaptic();
      fn?.();
    },
    [],
  );

  // Commit the rename. A no-op name (empty or unchanged) just closes the card
  // rather than firing a pointless write.
  const commitRename = useCallback(() => {
    const name = draftTitle.trim();
    if (!name || name === title) {
      onClose?.();
      return;
    }
    impactHaptic('medium');
    onRename?.(name);
  }, [draftTitle, title, onRename, onClose]);

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

      {/* Keyboard-lift anchor. Carries the absolute bottom-pinning so the card
          inside it is free to keep its own open/drag transform. */}
      <Reanimated.View pointerEvents="box-none" style={[styles.cardAnchor, keyboardLift]}>
      {/* The whole card is the pull-down-to-close zone. */}
      <Animated.View
        testID="track-actions-card"
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
            {/* Giving the track to a person, as against handing the FILE to
                whatever the OS offers above. Directly under Share because it
                is the other answer to the same question, and the one that
                keeps the track inside the pond. */}
            {api ? (
              <ActionRow
                testID="track-pond-open"
                icon="account-multiple-plus-outline"
                label={pond.people.length
                  ? `In your pond · ${pond.people.length}`
                  : 'Share in your pond…'}
                color={c.textPrimary}
                style={rowBorder}
                chevron
                onPress={() => {
                  tapHaptic();
                  setPage('pond');
                }}
              />
            ) : null}
            {/* Keeping the bytes on the phone. Sat under the two Share rows
                because it answers the same shape of question — where does
                this track live — and the label says what you GET rather than
                what it does, since "Download" already means Share's hand-the-
                file-to-the-OS on this sheet. */}
            {onToggleOffline ? (
              <ActionRow
                testID="track-offline-toggle"
                icon={offlineState === 'done' ? 'cloud-check-outline'
                  : offlineState === 'downloading' ? 'progress-download'
                  : offlineState === 'failed' ? 'alert-circle-outline'
                  : 'cloud-download-outline'}
                label={offlineState === 'done' ? 'Remove from this device'
                  : offlineState === 'downloading' ? `Downloading… ${Math.round((offlineProgress || 0) * 100)}% — stop`
                  : offlineState === 'failed' ? 'Download failed — try again'
                  : 'Keep on this device'}
                color={c.textPrimary}
                style={rowBorder}
                disabled={busy}
                // Deliberately NOT closing the sheet on a start: the label
                // turns into live progress, which is the only confirmation
                // that a download that takes a minute has begun at all.
                onPress={onToggleOffline}
              />
            ) : null}

            <ActionRow
              icon="pencil-outline"
              label="Rename track…"
              color={c.textPrimary}
              style={rowBorder}
              chevron
              onPress={() => {
                tapHaptic();
                setDraftTitle(title || '');
                setPage('rename');
              }}
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
            {/* Voice recordings. A FOLDER, not a playlist, and the label says
                the consequence rather than the mechanism: what goes in there
                leaves the music library and stops playing with everything
                else. Directly under "Add to playlist" because they are the
                two filing actions, and this is the one that MOVES the track
                rather than also listing it. */}
            {onToggleRecording ? (
              <ActionRow
                testID="track-toggle-recording"
                icon={isRecording ? 'music-note' : 'microphone'}
                label={isRecording ? 'Move back to music' : 'Move to Voice recordings'}
                color={c.textPrimary}
                style={rowBorder}
                onPress={run(onToggleRecording)}
              />
            ) : null}
            {/* Transcribe. Above the destructive row and below the filing
                ones, because it is a thing you DO to a track rather than a
                thing you do with the library. */}
            {onTranscribe ? (
              <ActionRow
                icon={transcriptState === 'running' ? 'progress-clock'
                  : transcriptState === 'done' ? 'text-box-check-outline' : 'signature-freehand'}
                label={transcriptState === 'running' ? 'Transcribing…'
                  : transcriptState === 'done' ? 'Transcribe again…' : 'Transcribe…'}
                color={c.textPrimary}
                style={rowBorder}
                chevron
                onPress={run(onTranscribe)}
              />
            ) : null}
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
        ) : page === 'rename' ? (
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
                  Rename track
                </Text>
                <Text style={[styles.subtitle, { color: c.textTertiary }]} numberOfLines={1}>
                  {subtitle}
                </Text>
              </View>
            </View>

            <View style={[styles.newRow, rowBorder]}>
              <Icon name="pencil-outline" size={20} color={c.textSecondary} />
              <AppTextInput
                testID="rename-track-input"
                style={[styles.newInput, { color: c.textPrimary }]}
                placeholder="Track name"
                placeholderTextColor={c.textMuted}
                value={draftTitle}
                onChangeText={setDraftTitle}
                autoFocus
                selectTextOnFocus
                returnKeyType="done"
                onSubmitEditing={commitRename}
              />
              {draftTitle.trim() && draftTitle.trim() !== title ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Save track name"
                  onPress={commitRename}
                >
                  <Text style={[styles.createText, { color: tint }]}>Save</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </>
        ) : page === 'pond' ? (
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
                  Share in your pond
                </Text>
                <Text style={[styles.subtitle, { color: c.textTertiary }]} numberOfLines={1}>
                  {title}
                </Text>
              </View>
            </View>

            <Text style={[styles.pondNote, { color: c.textTertiary }]}>
              The track turns up in their music. Nothing to send — their access is their login.
            </Text>

            {pond.error ? (
              <TouchableOpacity onPress={() => pond.setError(null)}>
                <Text style={[styles.pondError, { color: c.accentError || '#F87171' }]}>
                  {pond.error}
                </Text>
              </TouchableOpacity>
            ) : null}

            <ScrollView
              style={styles.playlistScroll}
              keyboardShouldPersistTaps="handled"
              {...SCROLL_INDICATOR}
              {...scrollProps}
            >
              {pond.loading ? (
                <Text style={[styles.empty, { color: c.textTertiary }]}>Loading…</Text>
              ) : (
                <>
                  {pond.people.map((person) => (
                    <View key={person.shareId} style={[styles.row, rowBorder]}>
                      <PersonDisc person={person} baseUrl={baseUrl} />
                      <Text style={[styles.rowLabel, { color: c.textPrimary }]} numberOfLines={1}>
                        {person.name}
                      </Text>
                      <TouchableOpacity
                        testID={`track-pond-remove-${person.userId}`}
                        accessibilityRole="button"
                        accessibilityLabel={`Stop sharing ${title} with ${person.name}`}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        disabled={pond.busyId === person.userId}
                        onPress={async () => {
                          notifyHaptic('warning');
                          notifyHaptic(await pond.revoke(person) ? 'success' : 'error');
                        }}
                      >
                        <Text style={[styles.createText, { color: c.textSecondary }]}>Remove</Text>
                      </TouchableOpacity>
                    </View>
                  ))}

                  {pond.addable.length === 0 ? (
                    <Text style={[styles.empty, { color: c.textTertiary }]}>
                      {pond.people.length
                        ? 'Everyone in your pond has this track.'
                        : 'Nobody else is in your pond yet.'}
                    </Text>
                  ) : (
                    pond.addable.map((member) => (
                      <ActionRow
                        key={member.id}
                        testID={`track-pond-add-${member.id}`}
                        icon="plus"
                        label={member.name}
                        color={c.textPrimary}
                        style={rowBorder}
                        disabled={!!pond.busyId}
                        onPress={async () => {
                          impactHaptic('medium');
                          notifyHaptic(await pond.grant(member) ? 'success' : 'error');
                        }}
                      />
                    ))
                  )}
                </>
              )}
            </ScrollView>
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
              <AppTextInput
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
            <ScrollView
              style={styles.playlistScroll}
              keyboardShouldPersistTaps="handled"
              {...SCROLL_INDICATOR}
              {...scrollProps}
            >
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
      </Reanimated.View>
    </View>
  );
}

/**
 * One person's disc — their picture where they have set one, the generated
 * animal underneath as the fallback rather than instead of it (STYLE-RULES §5).
 */
function PersonDisc({ person, size = 24, baseUrl }) {
  const uri = resolveAvatarUrl(person.avatarUrl, baseUrl);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }}>
      <AnimalAvatar id={person.userId || person.id} size={size} fallbackLabel={person.name} />
      {uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFillObject}
          contentFit="cover"
          transition={120}
          recyclingKey={`disc:${uri}`}
        />
      ) : null}
    </View>
  );
}

function ActionRow({ icon, label, color, onPress, style, disabled, chevron, testID }) {
  return (
    <TouchableOpacity
      testID={testID}
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
  // The bottom pin lives on the ANCHOR (which carries the keyboard lift), not
  // on the card — so the card's transform stays free for the open/drag motion.
  cardAnchor: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
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
  newInput: {
    ...INPUT_FIELD,
    flex: 1,
    fontSize: 15,
    height: 34,
  },
  createText: { fontSize: 14, fontWeight: '700' },
  playlistScroll: { maxHeight: 260 },
  empty: { fontSize: 13, paddingHorizontal: 18, paddingVertical: 18, lineHeight: 18 },
  pondNote: { fontSize: 12.5, paddingHorizontal: 18, paddingBottom: 12, lineHeight: 17 },
  pondError: { fontSize: 12.5, paddingHorizontal: 18, paddingBottom: 10 },
});
