/**
 * PhotoLinksSheet — every link that can currently show this photo.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * Sharing in Turtle is easy and permanent-ish, and nothing on a photo has ever
 * told you it was out there. Worse, exposure arrives two ways and only one of
 * them feels like sharing:
 *
 *   the DIRECT link — you pressed Share on this photo. You remember doing it.
 *
 *   an ALBUM link  — you shared an album once, and this photo carries that
 *                    album's name as a tag. You may never have thought about
 *                    this picture at all. Tagging it later, or a visitor
 *                    upload landing in the same album, adds it silently.
 *
 * The second is the whole reason for the screen. It is the one people forget,
 * and it is the one where "turn it off" has consequences beyond this photo —
 * so revoking an album link says how many other items go with it rather than
 * letting that be discovered afterwards.
 *
 * CHROME RULE: in-tree overlay, never a <Modal> — it opens from inside the
 * viewer, which is already a Modal, and a sibling Modal over an open Modal
 * silently fails to show on iOS. Same as AlbumShareSheet.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Linking, Pressable, ScrollView,
  StyleSheet, Text, View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { notifyHaptic, tapHaptic } from '../../../utils/haptics';
import { useSheetDismiss } from '../../../utils/useSheetDismiss';
import shareOneLink from '../../../utils/shareLink';
import { loadShareExposure, revokeExposureLink } from '../../../services/mediaShareLinks';

/** "3 views" / "not opened yet" — plain language, since 0 is the common case. */
function viewLabel(n) {
  if (!n) return 'Not opened yet';
  return `${n} ${n === 1 ? 'open' : 'opens'}`;
}

export default function PhotoLinksSheet({
  visible, media, api, theme, onClose, onChanged, bottomInset = 0,
}) {
  const insets = useSafeAreaInsets();
  const rest = Math.max(bottomInset, insets.bottom, 14);
  const { panHandlers, scrollProps, sheetDragStyle } = useSheetDismiss(onClose, visible);

  const [state, setState] = useState({ loading: true, links: [], errors: [] });
  const [busyId, setBusyId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  const mediaId = media?.id;

  const load = useCallback(async () => {
    if (!mediaId) return;
    setState((s) => ({ ...s, loading: true }));
    const res = await loadShareExposure(api, mediaId);
    setState({ loading: false, links: res.links, errors: res.errors });
  }, [api, mediaId]);

  useEffect(() => {
    if (!visible) return;
    setCopiedId(null);
    load();
  }, [visible, load]);

  const copy = useCallback(async (link) => {
    tapHaptic();
    await Clipboard.setStringAsync(link.url);
    setCopiedId(link.id + link.kind);
    setTimeout(() => setCopiedId((c) => (c === link.id + link.kind ? null : c)), 1800);
  }, []);

  // Open the link the way a RECIPIENT would — out to the browser, not an
  // in-app webview, because the whole question this screen answers is "what
  // does someone who has this URL actually get?". Falling back to copy means
  // the tap always does something: openURL rejects when no handler is
  // registered, and a silent no-op reads as a broken row. Mirrors
  // ShareInsightsPage's openLink.
  const openLink = useCallback(async (link) => {
    tapHaptic();
    try {
      await Linking.openURL(link.url);
    } catch {
      await Clipboard.setStringAsync(link.url);
      Alert.alert('Copied instead', 'Nothing on this device could open the link, so it’s on your clipboard.');
    }
  }, []);

  const send = useCallback(async (link) => {
    tapHaptic();
    try {
      await shareOneLink(link.url);
    } catch { /* user dismissed the sheet */ }
  }, []);

  const revoke = useCallback((link) => {
    // An album link is not this photo's to kill quietly. Turning it off takes
    // the whole album away from everyone holding the URL, so the consequence
    // is in the question rather than in the aftermath.
    const body = link.kind === 'album'
      ? `This turns off the whole “${link.album}” album for everyone holding the link — not just this photo.`
      : 'Anyone who already has this link will lose access immediately.';
    Alert.alert('Turn off this link?', body, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Turn off',
        style: 'destructive',
        onPress: async () => {
          setBusyId(link.id + link.kind);
          // Optimistic: the row greys out now, the DELETE follows.
          setState((s) => ({
            ...s,
            links: s.links.map((l) => (l === link ? { ...l, dead: true } : l)),
          }));
          try {
            await revokeExposureLink(api, link);
            notifyHaptic('success');
            onChanged?.();
          } catch (e) {
            setState((s) => ({
              ...s,
              links: s.links.map((l) => (l.id === link.id && l.kind === link.kind
                ? { ...l, dead: false } : l)),
            }));
            notifyHaptic('error');
            Alert.alert('Could not turn it off', e?.message || 'Try again in a moment.');
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  }, [api, onChanged]);

  if (!visible) return null;
  const s = makeStyles(theme);

  const live = state.links.filter((l) => !l.dead);
  const past = state.links.filter((l) => l.dead);

  const row = (link) => {
    const key = link.id + link.kind;
    const isAlbum = link.kind === 'album';
    return (
      <View key={key} style={[s.card, link.dead && s.cardDead]}>
        <View style={s.cardTop}>
          <MaterialCommunityIcons
            name={link.hasPassword ? 'lock' : isAlbum ? 'image-multiple' : 'link-variant'}
            size={14}
            color={link.dead ? theme.colors.textMuted : theme.colors.textSecondary}
          />
          <Text style={s.cardKind} numberOfLines={1}>
            {isAlbum ? `In “${link.album}”` : 'This photo’s own link'}
          </Text>
          <View style={{ flex: 1 }} />
          <Text style={s.cardMeta}>
            {link.dead
              ? (link.revokedAt ? 'Turned off' : 'Expired')
              : viewLabel(link.viewCount)}
          </Text>
        </View>

        {/* The album case again, in the row itself: someone scanning the list
            should not have to tap Turn off to learn the blast radius. */}
        {isAlbum && !link.dead && (
          <Text style={s.cardNote}>
            Shared as an album — everything tagged “{link.album}” is in it.
          </Text>
        )}

        {/* Tappable, and styled like the link it is. A dead link stays plain
            text — there is nothing at the other end of it any more, so making
            it look tappable would only earn a 404. */}
        {link.dead ? (
          <Text style={[s.url, s.urlDead]} numberOfLines={2} selectable>
            {link.url}
          </Text>
        ) : (
          <Pressable
            onPress={() => openLink(link)}
            accessibilityRole="link"
            accessibilityLabel={`Open ${link.url}`}
            style={s.urlRow}
            hitSlop={6}
          >
            <Text style={[s.url, s.urlLive]} numberOfLines={2} selectable>
              {link.url}
            </Text>
            <MaterialCommunityIcons
              name="open-in-new"
              size={13}
              color={theme.colors.accentInfo}
            />
          </Pressable>
        )}

        {!link.dead && (
          <View style={s.actions}>
            <Pressable onPress={() => copy(link)} style={s.btn}>
              <MaterialCommunityIcons
                name={copiedId === key ? 'check' : 'content-copy'}
                size={13}
                color={theme.colors.textPrimary}
              />
              <Text style={s.btnText}>{copiedId === key ? 'Copied' : 'Copy'}</Text>
            </Pressable>
            <Pressable onPress={() => send(link)} style={s.btn}>
              <MaterialCommunityIcons name="share-variant" size={13} color={theme.colors.textPrimary} />
              <Text style={s.btnText}>Send</Text>
            </Pressable>
            <Pressable
              onPress={() => revoke(link)}
              disabled={busyId === key}
              style={[s.btnGhost, busyId === key && { opacity: 0.5 }]}
            >
              <MaterialCommunityIcons name="link-off" size={13} color={theme.colors.textSecondary} />
              <Text style={s.btnTextGhost}>Turn off</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={[StyleSheet.absoluteFill, s.backdrop]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <Animated.View
        {...panHandlers}
        style={[s.sheet, { paddingBottom: rest + 10 }, sheetDragStyle]}
      >
        <View style={s.grabber} />
        <View style={s.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>Where this photo is shared</Text>
            <Text style={s.subtitle} numberOfLines={1}>
              {media?.originalName || media?.filename || 'This photo'}
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={10} style={s.closeBtn}>
            <MaterialCommunityIcons name="close" size={18} color={theme.colors.textSecondary} />
          </Pressable>
        </View>

        {/* Said out loud rather than shown as an empty list: a request that
            failed and a photo that isn't shared look identical otherwise, and
            only one of them is safe to believe. */}
        {state.errors.length > 0 && (
          <View style={s.warnBox}>
            <MaterialCommunityIcons name="alert-outline" size={14} color={theme.colors.accentWarning || '#e0a33e'} />
            <Text style={s.warnText}>
              Couldn’t check {state.errors.includes('album') ? 'album links' : 'this photo’s own link'} —
              there may be more than what’s listed here.
            </Text>
          </View>
        )}

        <ScrollView style={s.scroll} scrollIndicatorInsets={{ right: 1 }} {...scrollProps}>
          {state.loading ? (
            <ActivityIndicator style={{ marginVertical: 24 }} color={theme.colors.textSecondary} />
          ) : state.links.length === 0 ? (
            <Text style={s.empty}>
              This photo isn’t shared anywhere. Use Share to send it as a link.
            </Text>
          ) : (
            <>
              {live.map(row)}
              {past.length > 0 && (
                <>
                  <Text style={s.sectionLabel}>NO LONGER ACTIVE</Text>
                  {past.map(row)}
                </>
              )}
            </>
          )}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end', zIndex: 70 },
  sheet: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.borderStrong,
    paddingHorizontal: 18,
    paddingTop: 8,
    maxHeight: '80%',
  },
  grabber: {
    alignSelf: 'center', width: 36, height: 4, borderRadius: 2,
    backgroundColor: theme.colors.borderStrong, marginBottom: 12,
  },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  title: { fontSize: 17, fontWeight: '800', color: theme.colors.textPrimary, letterSpacing: -0.2 },
  subtitle: { fontSize: 12.5, color: theme.colors.textSecondary, marginTop: 3 },
  closeBtn: {
    width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.colors.surfaceHighlight,
  },
  warnBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 7,
    marginTop: 12, padding: 10, borderRadius: 10,
    backgroundColor: 'rgba(224,163,62,0.12)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(224,163,62,0.38)',
  },
  warnText: { flex: 1, fontSize: 12, color: theme.colors.textPrimary, lineHeight: 17 },
  scroll: { marginTop: 14 },
  empty: { color: theme.colors.textMuted, fontSize: 13, paddingVertical: 10, lineHeight: 19 },
  sectionLabel: {
    fontSize: 10, fontWeight: '800', letterSpacing: 0.7, color: theme.colors.textMuted,
    marginTop: 8, marginBottom: 6,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border,
    borderRadius: 12, padding: 12, marginBottom: 8, backgroundColor: theme.colors.surfaceElevated,
  },
  cardDead: { opacity: 0.5 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  cardKind: { fontSize: 12, fontWeight: '700', color: theme.colors.textSecondary, flexShrink: 1 },
  cardMeta: { fontSize: 11, color: theme.colors.textMuted },
  cardNote: { fontSize: 11.5, color: theme.colors.textMuted, marginBottom: 7, lineHeight: 16 },
  url: { fontSize: 11.5, color: theme.colors.textPrimary, flexShrink: 1 },
  urlRow: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    marginBottom: 10, paddingVertical: 2,
  },
  urlLive: { color: theme.colors.accentInfo, textDecorationLine: 'underline' },
  urlDead: { textDecorationLine: 'line-through', color: theme.colors.textMuted, marginBottom: 10 },
  actions: { flexDirection: 'row', gap: 8 },
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 11,
    borderRadius: 9, backgroundColor: theme.colors.surfaceHighlight,
  },
  btnText: { fontSize: 12, fontWeight: '600', color: theme.colors.textPrimary },
  btnGhost: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 11,
    borderRadius: 9, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border,
  },
  btnTextGhost: { fontSize: 12, fontWeight: '600', color: theme.colors.textSecondary },
});
