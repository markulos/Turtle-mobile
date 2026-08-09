/**
 * AlbumShareSheet — publish a vault album to the web.
 *
 * Mints a public link (`<host>/s/<slug>`) that opens the album in any
 * browser with no Turtle account. The link IS the credential, so the copy
 * here says that plainly rather than implying it's private; an optional
 * password adds a second gate, and "Turn off" revokes instantly.
 *
 * Rendered as an IN-TREE overlay, never a <Modal>: the vault already lives
 * inside one, and a sibling Modal over an open Modal silently fails to show
 * on iOS (see memory: ios-nested-pagesheet-modal-gotcha).
 *
 * CHROME RULE: because it is in-tree, the app's floating tab dock renders OVER
 * it. The card is a pinned surface — nothing scrolls it clear of the dock — so
 * it rests on `bottomInset` (= dockOccupied(insets.bottom) from the caller) and
 * the keyboard lift cancels exactly that same clearance.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet,
  Switch, Text, TextInput, View,
} from 'react-native';
import Reanimated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { impactHaptic, notifyHaptic, tapHaptic } from '../../../utils/haptics';

const isDead = (s) => !!s.revokedAt || !!(s.expiresAt && s.expiresAt < Date.now());

const EVENT_LABEL = {
  view: 'Opened',
  unlock_ok: 'Unlocked',
  unlock_fail: 'Wrong password',
  download: 'Downloaded',
};

/**
 * Visit log for one link. Honest about its limits: public links are anonymous,
 * so there is no "who" — only when, from where (network origin, or a city when
 * the server has geo lookups enabled), and whether it looked like a person or
 * a link-preview bot.
 */
function ShareActivity({ shareId, api, theme, styles }) {
  const [state, setState] = useState({ loading: true, visits: [], summary: null, places: [], geoEnabled: false, error: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get(`/album-shares/${shareId}/visits?limit=50`);
        if (cancelled) return;
        setState({
          loading: false,
          visits: res?.visits || [],
          summary: res?.summary || null,
          places: res?.places || [],
          geoEnabled: !!res?.geoEnabled,
          error: null,
        });
      } catch (e) {
        if (!cancelled) setState((s) => ({ ...s, loading: false, error: e?.message || 'Could not load activity' }));
      }
    })();
    return () => { cancelled = true; };
  }, [shareId, api]);

  if (state.loading) return <ActivityIndicator style={{ marginVertical: 12 }} color={theme.colors.textSecondary} />;
  if (state.error) return <Text style={styles.activityEmpty}>{state.error}</Text>;
  if (!state.visits.length) return <Text style={styles.activityEmpty}>Nobody has opened this link yet.</Text>;

  const s = state.summary || {};
  return (
    <View style={styles.activityBlock}>
      <View style={styles.statRow}>
        <View style={styles.stat}><Text style={styles.statValue}>{s.views ?? 0}</Text><Text style={styles.statLabel}>opens</Text></View>
        <View style={styles.stat}><Text style={styles.statValue}>{s.uniqueVisitors ?? 0}</Text><Text style={styles.statLabel}>visitors</Text></View>
        <View style={styles.stat}><Text style={styles.statValue}>{s.downloads ?? 0}</Text><Text style={styles.statLabel}>downloads</Text></View>
        {(s.failedUnlocks ?? 0) > 0 && (
          <View style={styles.stat}><Text style={styles.statValue}>{s.failedUnlocks}</Text><Text style={styles.statLabel}>bad pw</Text></View>
        )}
        {(s.botHits ?? 0) > 0 && (
          <View style={styles.stat}><Text style={styles.statValue}>{s.botHits}</Text><Text style={styles.statLabel}>bots</Text></View>
        )}
      </View>

      {state.places.length > 0 && (
        <View style={styles.placeRow}>
          {state.places.slice(0, 5).map((p) => (
            <View key={p.place} style={styles.placeChip}>
              <MaterialCommunityIcons name="map-marker-outline" size={10} color={theme.colors.textSecondary} />
              <Text style={styles.placeText}>{p.place} · {p.n}</Text>
            </View>
          ))}
        </View>
      )}

      {state.visits.slice(0, 25).map((v, i) => (
        <View key={i} style={[styles.visitRow, v.isBot && { opacity: 0.6 }]}>
          <MaterialCommunityIcons
            name={v.isBot ? 'robot-outline' : 'earth'}
            size={12}
            color={v.isBot ? theme.colors.textMuted : theme.colors.textSecondary}
          />
          <Text style={styles.visitEvent}>{EVENT_LABEL[v.event] || v.event}</Text>
          <Text style={styles.visitMeta} numberOfLines={1}>
            {[v.place || v.origin, v.client].filter(Boolean).join(' · ')}
          </Text>
          <Text style={styles.visitTime}>
            {new Date(v.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </Text>
        </View>
      ))}

      {!state.geoEnabled && (
        <Text style={styles.activityFootnote}>
          Network origin only. City/country needs SHARE_GEO_LOOKUP=1 on the server, which sends
          each visitor's IP to a third-party lookup service.
        </Text>
      )}
    </View>
  );
}

export default function AlbumShareSheet({ visible, albumName, api, theme, onClose, bottomInset = 0 }) {
  const insets = useSafeAreaInsets();
  // Clearance the card rests on: the floating dock when there is one, the
  // home-indicator inset when there isn't (share target / chat's vault page).
  const rest = Math.max(bottomInset, insets.bottom, 14);
  // The password field rides the keyboard frame-for-frame. The lift cancels the
  // resting clearance — mixing the two parks the card above the keyboard.
  const keyboard = useAnimatedKeyboard();
  const keyboardLift = useAnimatedStyle(() => {
    'worklet';
    return { transform: [{ translateY: -Math.max(keyboard.height.value - rest, 0) }] };
  });
  const [shares, setShares] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [allowDownload, setAllowDownload] = useState(true);
  // Which link has its visit log expanded (null = none).
  const [openActivity, setOpenActivity] = useState(null);

  const load = useCallback(async () => {
    if (!albumName) return;
    setLoading(true);
    try {
      const res = await api.get(`/album-shares?album=${encodeURIComponent(albumName)}`);
      setShares(res?.shares || []);
      setError(null);
    } catch (e) {
      setError(e?.message || 'Could not load links');
    } finally {
      setLoading(false);
    }
  }, [albumName, api]);

  useEffect(() => {
    if (!visible) return;
    // Reset the form each time the sheet opens so a password typed for one
    // album never carries into the next.
    setUsePassword(false);
    setPassword('');
    setAllowDownload(true);
    setError(null);
    load();
  }, [visible, load]);

  const createLink = useCallback(async () => {
    if (usePassword && password.trim().length < 4) {
      setError('Password must be at least 4 characters.');
      return;
    }
    impactHaptic('medium');
    setBusy(true);
    setError(null);
    try {
      const res = await api.post('/album-shares', {
        album: albumName,
        password: usePassword ? password : undefined,
        allowDownload,
      });
      if (!res?.share) throw new Error(res?.error || 'Could not create the link');
      setShares((prev) => [res.share, ...prev]);
      setUsePassword(false);
      setPassword('');
      notifyHaptic('success');
      await Clipboard.setStringAsync(res.share.url);
      setCopiedId(res.share.id);
      setTimeout(() => setCopiedId((c) => (c === res.share.id ? null : c)), 1800);
    } catch (e) {
      setError(e?.message || 'Could not create the link');
    } finally {
      setBusy(false);
    }
  }, [albumName, allowDownload, api, password, usePassword]);

  const copyLink = useCallback(async (share) => {
    tapHaptic();
    await Clipboard.setStringAsync(share.url);
    setCopiedId(share.id);
    setTimeout(() => setCopiedId((c) => (c === share.id ? null : c)), 1800);
  }, []);

  const shareLink = useCallback(async (share) => {
    tapHaptic();
    try {
      await Share.share({ message: share.url, url: share.url });
    } catch { /* user dismissed the sheet */ }
  }, []);

  const revoke = useCallback((share) => {
    // The one destructive action: it kills the link for everyone holding it.
    Alert.alert(
      'Turn off this link?',
      `Anyone who already has it will immediately lose access to “${albumName}”.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Turn off',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            // Optimistic: the row greys out now, the DELETE follows.
            setShares((prev) => prev.map((s) => (
              s.id === share.id ? { ...s, revokedAt: Date.now() } : s
            )));
            try {
              await api.delete(`/album-shares/${share.id}`);
              notifyHaptic('success');
            } catch (e) {
              setShares((prev) => prev.map((s) => (
                s.id === share.id ? { ...s, revokedAt: null } : s
              )));
              setError(e?.message || 'Could not turn off the link');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }, [albumName, api]);

  if (!visible) return null;
  const s = makeStyles(theme);

  return (
    <View style={[StyleSheet.absoluteFill, s.backdrop]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      {/* The lift rides the card itself — it carries no other transform. */}
      <Reanimated.View style={[s.sheet, { paddingBottom: rest + 10 }, keyboardLift]}>
        <View style={s.grabber} />
        <View style={s.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.title} numberOfLines={1}>Share “{albumName}”</Text>
            <Text style={s.subtitle}>
              Anyone with the link can view this album in a browser — no account needed.
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={10} style={s.closeBtn}>
            <MaterialCommunityIcons name="close" size={18} color={theme.colors.textSecondary} />
          </Pressable>
        </View>

        {!!error && (
          <Pressable onPress={() => setError(null)} style={s.errorBox}>
            <Text style={s.errorText}>{error}</Text>
          </Pressable>
        )}

        <ScrollView style={s.scroll} keyboardShouldPersistTaps="handled">
          {loading ? (
            <ActivityIndicator style={{ marginVertical: 22 }} color={theme.colors.textSecondary} />
          ) : shares.length === 0 ? (
            <Text style={s.empty}>No links yet.</Text>
          ) : (
            shares.map((share) => {
              const dead = isDead(share);
              return (
                <View key={share.id} style={[s.linkCard, dead && s.linkCardDead]}>
                  <View style={s.linkTop}>
                    <MaterialCommunityIcons
                      name={share.hasPassword ? 'lock' : 'earth'}
                      size={13}
                      color={theme.colors.textSecondary}
                    />
                    <Text style={s.linkKind}>
                      {share.hasPassword ? 'Password protected' : 'Anyone with the link'}
                    </Text>
                    <View style={{ flex: 1 }} />
                    <Text style={s.linkMeta}>
                      {dead
                        ? (share.revokedAt ? 'Turned off' : 'Expired')
                        : `${share.viewCount} ${share.viewCount === 1 ? 'view' : 'views'}`}
                    </Text>
                  </View>
                  <Text style={[s.url, dead && s.urlDead]} numberOfLines={2} selectable>
                    {share.url}
                  </Text>
                  {!dead && (
                    <View style={s.linkActions}>
                      <Pressable onPress={() => copyLink(share)} style={s.actionBtn}>
                        <MaterialCommunityIcons
                          name={copiedId === share.id ? 'check' : 'content-copy'}
                          size={13}
                          color={theme.colors.textPrimary}
                        />
                        <Text style={s.actionText}>{copiedId === share.id ? 'Copied' : 'Copy'}</Text>
                      </Pressable>
                      <Pressable onPress={() => shareLink(share)} style={s.actionBtn}>
                        <MaterialCommunityIcons name="share-variant" size={13} color={theme.colors.textPrimary} />
                        <Text style={s.actionText}>Share</Text>
                      </Pressable>
                      <Pressable onPress={() => revoke(share)} disabled={busy} style={s.actionBtnGhost}>
                        <MaterialCommunityIcons name="link-off" size={13} color={theme.colors.textSecondary} />
                        <Text style={s.actionTextGhost}>Turn off</Text>
                      </Pressable>
                    </View>
                  )}
                  {/* Offered even for a dead link — you may care MORE about who
                      hit a link you already turned off. */}
                  <Pressable
                    onPress={() => {
                      tapHaptic();
                      setOpenActivity((c) => (c === share.id ? null : share.id));
                    }}
                    style={s.activityToggle}
                  >
                    <MaterialCommunityIcons name="chart-line-variant" size={12} color={theme.colors.textSecondary} />
                    <Text style={s.activityToggleText}>Activity</Text>
                    <MaterialCommunityIcons
                      name={openActivity === share.id ? 'chevron-up' : 'chevron-down'}
                      size={14}
                      color={theme.colors.textMuted}
                    />
                  </Pressable>
                  {openActivity === share.id && (
                    <ShareActivity shareId={share.id} api={api} theme={theme} styles={s} />
                  )}
                </View>
              );
            })
          )}

          {/* ── new link ─────────────────────────────────────────────── */}
          <View style={s.newBlock}>
            <Text style={s.sectionLabel}>NEW LINK</Text>

            <View style={s.optionRow}>
              <Text style={s.optionText}>Require a password</Text>
              <Switch
                value={usePassword}
                onValueChange={(v) => { tapHaptic(); setUsePassword(v); }}
                trackColor={{ true: theme.colors.accentInfo }}
              />
            </View>
            {usePassword && (
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Password for viewers (min 4 characters)"
                placeholderTextColor={theme.colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                style={s.input}
              />
            )}

            <View style={s.optionRow}>
              <Text style={s.optionText}>Allow downloading originals</Text>
              <Switch
                value={allowDownload}
                onValueChange={(v) => { tapHaptic(); setAllowDownload(v); }}
                trackColor={{ true: theme.colors.accentInfo }}
              />
            </View>

            <Pressable onPress={createLink} disabled={busy} style={[s.createBtn, busy && { opacity: 0.6 }]}>
              {busy
                ? <ActivityIndicator size="small" color={theme.colors.background} />
                : <MaterialCommunityIcons name="link-variant-plus" size={16} color={theme.colors.background} />}
              <Text style={s.createText}>Create link</Text>
            </Pressable>
          </View>
        </ScrollView>
      </Reanimated.View>
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end', zIndex: 60 },
  sheet: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.borderStrong,
    paddingHorizontal: 18,
    paddingTop: 8,
    maxHeight: '86%',
  },
  grabber: {
    alignSelf: 'center', width: 36, height: 4, borderRadius: 2,
    backgroundColor: theme.colors.borderStrong, marginBottom: 12,
  },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  title: { fontSize: 17, fontWeight: '800', color: theme.colors.textPrimary, letterSpacing: -0.2 },
  subtitle: { fontSize: 12.5, color: theme.colors.textSecondary, marginTop: 3, lineHeight: 17 },
  closeBtn: {
    width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.colors.surfaceHighlight,
  },
  errorBox: {
    marginTop: 12, padding: 9, borderRadius: 9,
    backgroundColor: 'rgba(255,69,58,0.12)', borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,69,58,0.35)',
  },
  errorText: { color: '#ff6b6b', fontSize: 12.5 },
  scroll: { marginTop: 14 },
  empty: { color: theme.colors.textMuted, fontSize: 13, paddingVertical: 6 },
  linkCard: {
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border,
    borderRadius: 12, padding: 12, marginBottom: 8, backgroundColor: theme.colors.surfaceElevated,
  },
  linkCardDead: { opacity: 0.5 },
  linkTop: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 7 },
  linkKind: { fontSize: 11.5, fontWeight: '700', color: theme.colors.textSecondary },
  linkMeta: { fontSize: 11, color: theme.colors.textMuted },
  url: { fontSize: 11.5, color: theme.colors.textPrimary, marginBottom: 10 },
  urlDead: { textDecorationLine: 'line-through', color: theme.colors.textMuted },
  linkActions: { flexDirection: 'row', gap: 8 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 11,
    borderRadius: 9, backgroundColor: theme.colors.surfaceHighlight,
  },
  actionText: { fontSize: 12, fontWeight: '600', color: theme.colors.textPrimary },
  actionBtnGhost: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 11,
    borderRadius: 9, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border,
  },
  actionTextGhost: { fontSize: 12, fontWeight: '600', color: theme.colors.textSecondary },
  activityToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 9, paddingVertical: 3,
  },
  activityToggleText: { fontSize: 12, fontWeight: '600', color: theme.colors.textSecondary, flex: 1 },
  activityBlock: {
    marginTop: 8, paddingTop: 9,
    borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border,
  },
  activityEmpty: { fontSize: 12, color: theme.colors.textMuted, marginTop: 8 },
  activityFootnote: {
    fontSize: 10.5, color: theme.colors.textMuted, marginTop: 8, lineHeight: 15,
  },
  statRow: { flexDirection: 'row', gap: 14, marginBottom: 10 },
  stat: { minWidth: 52 },
  statValue: { fontSize: 15, fontWeight: '800', color: theme.colors.textPrimary },
  statLabel: { fontSize: 10, color: theme.colors.textMuted },
  placeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginBottom: 10 },
  placeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999,
    backgroundColor: theme.colors.surfaceHighlight,
  },
  placeText: { fontSize: 10.5, color: theme.colors.textSecondary },
  visitRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border,
  },
  visitEvent: { fontSize: 11.5, fontWeight: '600', color: theme.colors.textPrimary, minWidth: 88 },
  visitMeta: { fontSize: 11, color: theme.colors.textMuted, flex: 1 },
  visitTime: { fontSize: 10.5, color: theme.colors.textMuted },
  newBlock: {
    marginTop: 6, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border,
  },
  sectionLabel: {
    fontSize: 10, fontWeight: '800', letterSpacing: 0.7, color: theme.colors.textMuted, marginBottom: 4,
  },
  optionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8, gap: 12,
  },
  optionText: { fontSize: 14, color: theme.colors.textPrimary, flex: 1 },
  input: {
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, borderRadius: 10,
    paddingHorizontal: 12, height: 42, paddingVertical: 0, textAlignVertical: 'center',
    color: theme.colors.textPrimary, fontSize: 14, backgroundColor: theme.colors.surfaceElevated,
  },
  createBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 14, height: 46, borderRadius: 12, backgroundColor: theme.colors.primary,
  },
  createText: { fontSize: 15, fontWeight: '800', color: theme.colors.background },
});
