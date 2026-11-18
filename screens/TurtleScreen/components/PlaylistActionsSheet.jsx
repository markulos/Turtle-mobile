/**
 * PlaylistActionsSheet — giving a whole playlist to somebody in the pond.
 *
 * Mark, 2026-11-18: "allow to share entire playlists with other users in the
 * pond".
 *
 * ── Why there is no new endpoint behind this ─────────────────────────────
 *
 * A playlist is a TAG on audio rows, and a photo board is a tag on image rows.
 * They are the same object. `server/routes/albumAccess.js` says so in as many
 * words — "A MUSIC PLAYLIST IS THE SAME THING… that is why the phone can hang
 * a share button off a playlist with no new endpoint" — so this sheet talks to
 * `/api/album-access` with the playlist's name and the pond does the rest.
 *
 * Which means the grant is a NAME, not a list of tracks, and that is the
 * better shape: a track added to the playlist tomorrow is already shared, and
 * one revoke takes the whole thing back. (The read path on the server pins
 * every query to the owner recorded on the share row, so two people with a
 * "Chill" playlist have two different playlists.)
 *
 * ── What it is NOT ──────────────────────────────────────────────────────
 *
 * It does not share the tracks somebody ELSE shared with me that I have put on
 * this playlist. Those are not mine to pass on, the server would not grant
 * them, and the sheet says so rather than letting the count quietly disagree
 * with what the recipient gets.
 */
import React from 'react';
import {
  Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import AnimalAvatar from '../../../components/AnimalAvatar';
import { Image } from 'expo-image';
import { usePondAccess } from '../../../utils/usePondAccess';
import { resolveAvatarUrl } from '../../../utils/avatarUrl';
import { impactHaptic, notifyHaptic, tapHaptic } from '../../../utils/haptics';
import { SCROLL_INDICATOR } from '../../../utils/scrollIndicator';

function PersonDisc({ person, size = 26, baseUrl }) {
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

export default function PlaylistActionsSheet({
  visible,
  name,
  trackCount = 0,
  guestCount = 0,
  api,
  baseUrl,
  colors,
  bottomInset = 0,
  onClose,
  onChanged,
}) {
  const c = colors;
  const pond = usePondAccess(api, {
    kind: 'album',
    id: name,
    enabled: !!visible && !!name,
    onChanged,
  });

  if (!visible || !name) return null;

  const rowBorder = { borderTopColor: c.border };

  return (
    <View style={[StyleSheet.absoluteFill, styles.layer]} pointerEvents="box-none">
      <Animated.View
        entering={FadeIn.duration(140)}
        exiting={FadeOut.duration(120)}
        style={[StyleSheet.absoluteFill, styles.scrim]}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityLabel="Close playlist options"
          onPress={onClose}
        />
      </Animated.View>

      <View style={styles.anchor} pointerEvents="box-none">
        <View
          testID="playlist-actions-sheet"
          style={[
            styles.card,
            {
              backgroundColor: c.surfaceElevated || c.surface,
              borderColor: c.border,
              paddingBottom: bottomInset + 10,
            },
          ]}
        >
          <View style={styles.grabArea}>
            <View style={[styles.grabber, { backgroundColor: c.border }]} />
          </View>

          <View style={styles.headerRow}>
            <View style={[styles.art, { backgroundColor: `${c.accent}22` }]}>
              <Icon name="playlist-music" size={20} color={c.accentInk} />
            </View>
            <View style={styles.headerText}>
              <Text style={[styles.title, { color: c.textPrimary }]} numberOfLines={1}>{name}</Text>
              <Text style={[styles.subtitle, { color: c.textTertiary }]} numberOfLines={1}>
                {`${trackCount} track${trackCount === 1 ? '' : 's'}`}
              </Text>
            </View>
          </View>

          <Text style={[styles.note, { color: c.textTertiary }]}>
            The whole playlist turns up in their music, and so does anything you add to it
            later. Nothing to send — their access is their login.
          </Text>

          {/* SAID OUT LOUD rather than discovered. A playlist of mine can hold
              tracks somebody else shared with me, and those are not mine to
              pass on — the pond would refuse, and a count that disagreed with
              what the recipient saw would be the thing nobody could explain. */}
          {guestCount > 0 ? (
            <Text style={[styles.note, { color: c.textSecondary }]} testID="playlist-share-guest-note">
              {`${guestCount} shared track${guestCount === 1 ? '' : 's'} on this playlist ${guestCount === 1 ? 'stays' : 'stay'} with ${guestCount === 1 ? 'its' : 'their'} owner — only your own go.`}
            </Text>
          ) : null}

          {pond.error ? (
            <TouchableOpacity onPress={() => pond.setError(null)}>
              <Text style={[styles.error, { color: c.accentError || '#F87171' }]}>{pond.error}</Text>
            </TouchableOpacity>
          ) : null}

          <ScrollView
            style={styles.scroll}
            keyboardShouldPersistTaps="handled"
            {...SCROLL_INDICATOR}
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
                      testID={`playlist-pond-remove-${person.userId}`}
                      accessibilityRole="button"
                      accessibilityLabel={`Stop sharing ${name} with ${person.name}`}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      disabled={pond.busyId === person.userId}
                      onPress={async () => {
                        notifyHaptic('warning');
                        notifyHaptic(await pond.revoke(person) ? 'success' : 'error');
                      }}
                    >
                      <Text style={[styles.action, { color: c.textSecondary }]}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                ))}

                {pond.addable.length === 0 ? (
                  <Text style={[styles.empty, { color: c.textTertiary }]}>
                    {pond.people.length
                      ? 'Everyone in your pond has this playlist.'
                      : 'Nobody else is in your pond yet.'}
                  </Text>
                ) : (
                  pond.addable.map((member) => (
                    <View key={member.id} style={[styles.row, rowBorder]}>
                      <PersonDisc person={member} baseUrl={baseUrl} />
                      <Text style={[styles.rowLabel, { color: c.textPrimary }]} numberOfLines={1}>
                        {member.name}
                      </Text>
                      <TouchableOpacity
                        testID={`playlist-pond-add-${member.id}`}
                        accessibilityRole="button"
                        accessibilityLabel={`Share ${name} with ${member.name}`}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        disabled={pond.busyId === member.id}
                        onPress={async () => {
                          impactHaptic('medium');
                          notifyHaptic(await pond.grant(member) ? 'success' : 'error');
                        }}
                      >
                        <Text style={[styles.action, { color: c.accentInk }]}>Share</Text>
                      </TouchableOpacity>
                    </View>
                  ))
                )}
              </>
            )}
          </ScrollView>

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Done"
            onPress={() => { tapHaptic(); onClose?.(); }}
            style={styles.done}
          >
            <Text style={[styles.doneText, { color: c.textSecondary }]}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // The same layer the track card uses, for the same reason: the Playlists
  // page is a Modal and no z-index reaches across one, so this is drawn INSIDE
  // that page and has to clear its nested in-tree overlay (150).
  layer: { zIndex: 400, elevation: 400 },
  scrim: { backgroundColor: 'rgba(0,0,0,0.5)' },
  anchor: { position: 'absolute', left: 0, right: 0, bottom: 0 },
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
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 10 },
  headerText: { flex: 1 },
  art: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 15, fontWeight: '700' },
  subtitle: { fontSize: 12, marginTop: 1 },
  note: { fontSize: 11.5, lineHeight: 16, paddingHorizontal: 16, paddingBottom: 8 },
  error: { fontSize: 12.5, fontWeight: '600', paddingHorizontal: 16, paddingBottom: 8 },
  scroll: { maxHeight: 280 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 13,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: { flex: 1, fontSize: 14.5, fontWeight: '600' },
  action: { fontSize: 13, fontWeight: '700' },
  empty: { fontSize: 12.5, paddingHorizontal: 16, paddingVertical: 14 },
  done: { alignItems: 'center', paddingTop: 12, paddingBottom: 2 },
  doneText: { fontSize: 14, fontWeight: '700' },
});
