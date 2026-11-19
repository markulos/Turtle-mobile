/**
 * VaultShareSheet — hand one thing in the vault to somebody. Everything about
 * who can see it, in one card.
 *
 * Two subjects, because they need the identical sheet:
 *   · an ALBUM (a board — a tag over the owner's media), and
 *   · a FOLDER from the Files tab, where the share covers the SUBFOLDERS too.
 * `subject` carries which, and it decides one query parameter, one request
 * field and a few nouns. It was album-only (AlbumShareSheet) until folders
 * needed it; a second copy of 800 lines would have drifted within a month.
 *
 * Two ways to hand it over, in this order on purpose:
 *   · IN YOUR POND — it appears in their own vault. Access is their login, so
 *     there is nothing to send and nothing to leak.
 *   · A PUBLIC LINK (`<host>/s/<slug>`) that opens in any browser with no
 *     Turtle account. The link IS the credential, so the copy here says that
 *     plainly rather than implying it's private; an optional password adds a
 *     second gate, and "Turn off" revokes instantly.
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
  ActivityIndicator, Alert, Animated, Platform, Pressable, ScrollView, Share, StyleSheet,
  Switch, Text, View,
} from 'react-native';
import { Image } from 'expo-image';
import { depth } from '../../../utils/surfaceDepth';
import AppTextInput from '../../../components/AppTextInput';
import AnimalAvatar from '../../../components/AnimalAvatar';
import { resolveAvatarUrl } from '../../../utils/avatarUrl';
import { usePondAccess } from '../../../utils/usePondAccess';
import Reanimated, { useAnimatedStyle } from 'react-native-reanimated';
import { useKeyboardFrame } from '../../../utils/keyboardMotion';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { impactHaptic, notifyHaptic, tapHaptic } from '../../../utils/haptics';
import { useSheetDismiss } from '../../../utils/useSheetDismiss';
import { INPUT_FIELD } from '../../../utils/inputField';
import { SCROLL_INDICATOR } from '../../../utils/scrollIndicator';

const isDead = (s) => !!s.revokedAt || !!(s.expiresAt && s.expiresAt < Date.now());

/**
 * What this sheet is about: `{ kind: 'album' | 'folder', id, name }`.
 *
 * For an album, `id` and `name` are both the board's name — a board IS its
 * name. For a folder they differ: `id` is the row, `name` is what it is
 * called, and the server interprets the two very differently (a folder id is
 * global, a board name is only ever read against an owner). Everything below
 * goes through these three helpers so the difference cannot leak into the
 * layout.
 */
const NOUN = { album: 'board', folder: 'folder' };
const nounOf = (subject) => NOUN[subject?.kind] || 'board';
/** The query that lists this subject's public links. */
const linksQuery = (subject) => (subject.kind === 'folder'
  ? `/album-shares?folderId=${encodeURIComponent(subject.id)}`
  : `/album-shares?album=${encodeURIComponent(subject.id)}`);
/** The field that mints one. */
const mintField = (subject) => (subject.kind === 'folder'
  ? { folderId: subject.id }
  : { album: subject.id });

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

/**
 * One person's disc — their picture where they have set one, the generated
 * animal underneath as the FALLBACK rather than instead of it (STYLE-RULES §5,
 * the same rule FaceStack keeps for the grid).
 */
function PersonDisc({ person, size = 28, baseUrl }) {
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

/**
 * The pond half of a board's sharing — giving it to someone who already has an
 * account, as opposed to minting a link for someone who doesn't.
 *
 * Deliberately FIRST in the card, above the public link. Handing a board to the
 * person next to you is the common, safe case; a URL that is its own credential
 * is the one that deserves to be further down and read more carefully.
 *
 * Two reads on open: the roster for this board, and the pond's members so there
 * is something to pick from. They are independent, so a failure to list members
 * still shows who already has it — losing the roster because the directory is
 * unreachable would read as "shared with nobody", which is a different claim.
 */
function PondAccess({ subject, api, theme, styles: s, baseUrl, onChanged }) {
  const label = subject.name;
  const noun = nounOf(subject);
  // The exchange with the server lives in utils/usePondAccess — the music
  // track sheet holds the same conversation and must not drift from this one.
  const {
    people, addable, loading, busyId, error, setError, grant: grantAccess, revoke: revokeAccess,
    setPermission, canSetPermission,
  } = usePondAccess(api, { kind: subject.kind, id: subject.id, enabled: !!subject.id, onChanged });
  const [picking, setPicking] = useState(false);

  // A picker left open on one subject must not be open on the next.
  useEffect(() => { setPicking(false); }, [subject.id]);

  const grant = useCallback(async (member) => {
    impactHaptic('medium');
    notifyHaptic(await grantAccess(member) ? 'success' : 'error');
  }, [grantAccess]);

  /**
   * Flip one person between view and edit.
   *
   * Confirmed in both directions, and the copy spells out the verbs rather than
   * saying "edit": handing somebody the ability to take your files out of a
   * folder is not a thing to discover afterwards. Going back to view is
   * confirmed too, because it takes something away from a person who may be
   * halfway through using it.
   */
  const changePermission = useCallback((person) => {
    const toEdit = person.permission !== 'edit';
    Alert.alert(
      toEdit ? `Let ${person.name} edit “${label}”?` : `Make it view only for ${person.name}?`,
      toEdit
        ? 'They will be able to add files, take files out, rename folders and make new ones. They still cannot delete the folder or pass it on.'
        : 'They keep seeing the folder, but can no longer change anything in it. Files they already added stay where they are.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: toEdit ? 'Allow editing' : 'View only',
          onPress: async () => {
            impactHaptic('medium');
            notifyHaptic(await setPermission(person, toEdit ? 'edit' : 'view') ? 'success' : 'error');
          },
        },
      ],
    );
  }, [label, setPermission]);

  const revoke = useCallback((person) => {
    Alert.alert(
      `Stop sharing with ${person.name}?`,
      `“${label}” will disappear from their vault.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => { notifyHaptic(await revokeAccess(person) ? 'success' : 'error'); },
        },
      ],
    );
  }, [label, revokeAccess]);

  return (
    <View style={s.pondBlock}>
      <View style={s.sectionHead}>
        <MaterialCommunityIcons name="account-multiple" size={13} color={theme.colors.textSecondary} />
        <Text style={s.sectionTitle}>IN YOUR POND</Text>
      </View>
      <Text style={s.sectionNote}>
        {subject.kind === 'folder'
          ? 'The folder appears in their own Files, with the folders inside it. New shares are view only — tap a name to let them add files, take files out, rename folders and make new ones. Nobody you share with can delete the folder or pass it on.'
          : 'The board appears in their own vault. Nothing to send, nothing to leak — their access is their login.'}
      </Text>

      {!!error && (
        <Pressable onPress={() => setError(null)} style={s.errorBox}>
          <Text style={s.errorText}>{error}</Text>
        </Pressable>
      )}

      {loading ? (
        <ActivityIndicator style={{ marginVertical: 18 }} color={theme.colors.textSecondary} />
      ) : (
        <>
          {people.length === 0 ? (
            <Text style={s.empty}>Not shared with anyone yet.</Text>
          ) : (
            people.map((person) => (
              <View key={person.shareId} style={s.personRow}>
                <PersonDisc person={person} baseUrl={baseUrl} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.personName} numberOfLines={1}>{person.name}</Text>
                  {/* Tappable only where the pond will honour a change: a
                      board's grant has no permission to set, so there it stays
                      the plain line it always was. */}
                  {canSetPermission ? (
                    <Pressable
                      testID={`pond-access-permission-${person.userId}`}
                      onPress={() => { tapHaptic(); changePermission(person); }}
                      disabled={busyId === person.userId}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={person.permission === 'edit'
                        ? `${person.name} can edit ${label} — change to view only`
                        : `${person.name} can view ${label} — allow editing`}
                    >
                      <Text style={[s.personMeta, person.permission === 'edit' && s.personMetaOn]}>
                        {person.permission === 'edit' ? 'Can edit · tap to change' : 'Can view · tap to change'}
                      </Text>
                    </Pressable>
                  ) : (
                    <Text style={s.personMeta}>Can view</Text>
                  )}
                </View>
                <Pressable
                  testID={`pond-access-remove-${person.userId}`}
                  onPress={() => revoke(person)}
                  disabled={busyId === person.userId}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={`Stop sharing ${label} with ${person.name}`}
                  style={s.removeBtn}
                >
                  <Text style={s.removeText}>Remove</Text>
                </Pressable>
              </View>
            ))
          )}

          {/* The picker stays folded until asked for: on a board already shared
              with several people the roster is the answer, and a permanent list
              of everyone else would bury it. */}
          {picking ? (
            addable.length === 0 ? (
              <Text style={s.empty}>Everyone in your pond already has this {noun}.</Text>
            ) : (
              <View style={s.pickList}>
                {addable.map((member) => (
                  <Pressable
                    key={member.id}
                    testID={`pond-access-add-${member.id}`}
                    onPress={() => grant(member)}
                    disabled={!!busyId}
                    accessibilityRole="button"
                    accessibilityLabel={`Share ${label} with ${member.name}`}
                    style={({ pressed }) => [s.pickRow, pressed && { opacity: 0.6 }]}
                  >
                    <PersonDisc person={{ ...member, userId: member.id }} size={24} baseUrl={baseUrl} />
                    <Text style={s.pickName} numberOfLines={1}>{member.name}</Text>
                    {busyId === member.id
                      ? <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                      : <MaterialCommunityIcons name="plus" size={15} color={theme.colors.textSecondary} />}
                  </Pressable>
                ))}
              </View>
            )
          ) : (
            <Pressable
              testID="pond-access-open-picker"
              onPress={() => { tapHaptic(); setPicking(true); }}
              accessibilityRole="button"
              accessibilityLabel={`Share ${label} with someone in your pond`}
              style={s.addBtn}
            >
              <MaterialCommunityIcons name="account-plus-outline" size={15} color={theme.colors.textPrimary} />
              <Text style={s.addText}>Share with someone</Text>
            </Pressable>
          )}
        </>
      )}
    </View>
  );
}

export default function VaultShareSheet({ visible, subject, api, theme, onClose, bottomInset = 0, baseUrl }) {
  const label = subject?.name || '';
  const noun = nounOf(subject);
  // PRIMITIVES, and every effect and callback below keys on these rather than
  // on `subject`. Callers build the object inline (`subject={{ kind: 'album',
  // … }}`), so its identity changes on every render of the screen behind this
  // sheet — a dependency on the object itself would re-create `load`, re-fire
  // the effect, set state, and fetch the link list in a loop forever.
  const subjectKind = subject?.kind || 'album';
  const subjectId = subject?.id || '';
  const insets = useSafeAreaInsets();
  // Clearance the card rests on: the floating dock when there is one, the
  // home-indicator inset when there isn't (share target / chat's vault page).
  const rest = Math.max(bottomInset, insets.bottom, 14);
  // The password field rides the keyboard frame-for-frame. The lift cancels the
  // resting clearance — mixing the two parks the card above the keyboard.
  const keyboard = useKeyboardFrame();
  const keyboardLift = useAnimatedStyle(() => {
    'worklet';
    return { transform: [{ translateY: -Math.max(keyboard.height.value - rest, 0) }] };
  });
  // Pull down anywhere on the card to close — app-wide sheet behaviour. The
  // link list below reports its offset so the pull only closes from its top.
  const { panHandlers, scrollProps, sheetDragStyle } = useSheetDismiss(onClose, visible);
  const [shares, setShares] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [allowDownload, setAllowDownload] = useState(true);
  // Visitor uploads: whoever holds the link can ADD photos/videos/audio/PDFs
  // into this album. Server-enforced (magic-byte identification, per-slug+IP
  // rate limits, audit events) — but it is still an anonymous WRITE surface,
  // so it defaults OFF and turning it on is a per-link choice.
  const [allowUpload, setAllowUpload] = useState(false);
  // Which link has its visit log expanded (null = none).
  const [openActivity, setOpenActivity] = useState(null);
  // This pond's server predates folder links (see `load`). Never true for a
  // board — every version of that route has understood it.
  const [unsupported, setUnsupported] = useState(false);

  const load = useCallback(async () => {
    if (!subjectId) return;
    setLoading(true);
    try {
      const res = await api.get(linksQuery({ kind: subjectKind, id: subjectId }));
      // `filteredBy` is CHECKED, not decorative. A pond whose server predates
      // folder links ignores ?folderId= and answers with EVERY link its owner
      // has — listing unrelated boards' links as this folder's, each with a
      // Turn off button. Refuse that answer and say so.
      if (subjectKind === 'folder' && (res?.filteredBy ?? null) !== 'folderId') {
        setUnsupported(true);
        setShares([]);
        setError(null);
        return;
      }
      setUnsupported(false);
      setShares(res?.shares || []);
      setError(null);
    } catch (e) {
      setError(e?.message || 'Could not load links');
    } finally {
      setLoading(false);
    }
  }, [subjectKind, subjectId, api]);

  useEffect(() => {
    if (!visible) return;
    // Reset the form each time the sheet opens so a password typed for one
    // album never carries into the next.
    setUsePassword(false);
    setPassword('');
    setAllowDownload(true);
    setAllowUpload(false); // anonymous-write opt-in never carries between albums
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
        ...mintField({ kind: subjectKind, id: subjectId }),
        password: usePassword ? password : undefined,
        allowDownload,
        allowUpload,
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
  }, [subjectKind, subjectId, allowDownload, allowUpload, api, password, usePassword]);

  // Flip visitor uploads on an EXISTING link. Optimistic with revert — the
  // switch answers the finger now, the PATCH follows, and a failure puts the
  // old value back rather than lying about what the server enforces.
  const toggleUpload = useCallback(async (share, next) => {
    tapHaptic();
    setShares((prev) => prev.map((s) => (s.id === share.id ? { ...s, allowUpload: next } : s)));
    try {
      const res = await api.patch(`/album-shares/${share.id}`, { allowUpload: next });
      if (!res?.success) throw new Error(res?.error || 'update failed');
      if (res.share) setShares((prev) => prev.map((s) => (s.id === share.id ? res.share : s)));
    } catch (e) {
      setShares((prev) => prev.map((s) => (s.id === share.id ? { ...s, allowUpload: !next } : s)));
      setError(e?.message || 'Could not change visitor uploads');
      notifyHaptic('error');
    }
  }, [api]);

  const copyLink = useCallback(async (share) => {
    tapHaptic();
    await Clipboard.setStringAsync(share.url);
    setCopiedId(share.id);
    setTimeout(() => setCopiedId((c) => (c === share.id ? null : c)), 1800);
  }, []);

  const shareLink = useCallback(async (share) => {
    tapHaptic();
    try {
      // ONE link, not two. iOS reads `url` as a first-class URL item and
      // `message` as text — sending both puts the same link in the bubble
      // twice, once as a rich preview and once as bare text. Android's sheet
      // only reads `message`. (MediaGallery's single-item link share already
      // splits it this way; this sheet was the one that didn't.)
      await Share.share(Platform.OS === 'ios' ? { url: share.url } : { message: share.url });
    } catch { /* user dismissed the sheet */ }
  }, []);

  const revoke = useCallback((share) => {
    // The one destructive action: it kills the link for everyone holding it.
    Alert.alert(
      'Turn off this link?',
      `Anyone who already has it will immediately lose access to “${label}”.`,
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
  }, [label, api]);

  if (!visible) return null;
  const s = makeStyles(theme);

  return (
    <View style={[StyleSheet.absoluteFill, s.backdrop]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      {/* Keyboard-lift anchor. The card inside owns the drag transform, and an
          RN Animated value and a Reanimated style cannot drive the same node —
          so the lift rides this wrapper and the height cap moves up with it. */}
      <Reanimated.View style={[{ maxHeight: '86%' }, keyboardLift]}>
        <Animated.View
          {...panHandlers}
          style={[s.sheet, { maxHeight: '100%', paddingBottom: rest + 10 }, sheetDragStyle]}
        >
        <View style={s.grabber} />
        <View style={s.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.title} numberOfLines={1}>Sharing “{label}”</Text>
            <Text style={s.subtitle}>
              Everything about who can see this {noun}, in one place.
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

        <ScrollView
          style={s.scroll}
          keyboardShouldPersistTaps="handled"
          {...SCROLL_INDICATOR}
          {...scrollProps}
        >
          {/* ONE CARD, SECTIONED. This is the only place a board's sharing is
              changed now — the cog on its caption in the boards grid and the
              board menu's Share entry both land here, so the settings are not
              split across two entry points that drift apart. */}
          <PondAccess
            subject={subject}
            api={api}
            theme={theme}
            styles={s}
            baseUrl={baseUrl}
          />

          <View style={s.sectionHead}>
            <MaterialCommunityIcons name="earth" size={13} color={theme.colors.textSecondary} />
            <Text style={s.sectionTitle}>PUBLIC LINK</Text>
          </View>
          <Text style={s.sectionNote}>
            {subject.kind === 'folder'
              ? 'Anyone with the link can browse this folder and the folders inside it, in a browser — no account needed.'
              : 'Anyone with the link can view this board in a browser — no account needed.'}
          </Text>
          {/* A pond that cannot answer "which links does this folder have" also
              cannot mint one, so the whole link half stands down rather than
              offering a button that fails. */}
          {unsupported ? (
            <Text style={s.empty} testID="links-unsupported">
              This pond’s server cannot make a link for a folder yet — it only knows how to share
              boards. Share it with someone in your pond above, or update the server.
            </Text>
          ) : loading ? (
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
                      {share.allowUpload ? ' · drop box' : ''}
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
                  {/* Visitor uploads — per-link, flippable after creation.
                      Only on live links: a revoked/expired link can't accept
                      anything, so a toggle there would be theater. */}
                  {!dead && (
                    <View style={s.optionRow}>
                      <Text style={s.optionText}>Visitor uploads</Text>
                      <Switch
                        value={!!share.allowUpload}
                        onValueChange={(v) => toggleUpload(share, v)}
                        trackColor={{ true: theme.colors.accentInfo }}
                      />
                    </View>
                  )}
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
          {!unsupported && (
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
              <AppTextInput
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

            <View style={s.optionRow}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={[s.optionText, { flex: 0 }]}>Let visitors add to this {noun}</Text>
                <Text style={s.optionHint}>
                  Anyone with the link can upload photos, videos, audio and PDFs. Files are verified and rate-limited by the server.
                </Text>
              </View>
              <Switch
                value={allowUpload}
                onValueChange={(v) => { tapHaptic(); setAllowUpload(v); }}
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
          )}
        </ScrollView>
        </Animated.View>
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
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2, marginBottom: 2 },
  sectionTitle: {
    fontSize: 10.5, fontWeight: '700', letterSpacing: 0.9,
    color: theme.colors.textSecondary,
  },
  sectionNote: { fontSize: 12, color: theme.colors.textTertiary, marginBottom: 10, lineHeight: 16 },
  empty: { color: theme.colors.textMuted, fontSize: 13, paddingVertical: 6 },
  // The pond section and the public-link section are peers in one card; the
  // rule between them is what says "different kind of access", not a gap.
  pondBlock: {
    paddingBottom: 14,
    marginBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  personName: { fontSize: 14, fontWeight: '600', color: theme.colors.textPrimary },
  personMeta: { fontSize: 11.5, color: theme.colors.textTertiary, marginTop: 1 },
  // Edit is the louder of the two states on purpose: it is the one worth
  // noticing when you scan the roster.
  personMetaOn: { color: theme.colors.accentPrimary, fontWeight: '600' },
  removeBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: theme.colors.surfaceHighlight },
  removeText: { fontSize: 12, fontWeight: '600', color: theme.colors.textSecondary },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    marginTop: 8, paddingVertical: 10, borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.borderStrong,
  },
  addText: { fontSize: 13, fontWeight: '600', color: theme.colors.textPrimary },
  pickList: {
    marginTop: 8, borderRadius: 10, overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border,
  },
  pickRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 9, paddingHorizontal: 11,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border,
  },
  pickName: { flex: 1, fontSize: 13.5, color: theme.colors.textPrimary, minWidth: 0 },
  linkCard: {
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border,
    borderRadius: 12, padding: 12, marginBottom: 8, backgroundColor: theme.colors.surfaceElevated,
    ...depth(theme, 'card'),
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
  optionHint: { fontSize: 11.5, color: theme.colors.textMuted, marginTop: 2, lineHeight: 15 },
  input: {
    ...INPUT_FIELD,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, borderRadius: 10,
    paddingHorizontal: 12, height: 42,
    color: theme.colors.textPrimary, fontSize: 14, backgroundColor: theme.colors.surfaceElevated,
    ...depth(theme, 'control'),
  },
  createBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 14, height: 46, borderRadius: 12, backgroundColor: theme.colors.primary,
  },
  createText: { fontSize: 15, fontWeight: '800', color: theme.colors.background },
});
