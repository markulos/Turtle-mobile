/**
 * SelectionShareLinkSheet — name a multi-selection, get one public link.
 *
 * The sibling of AlbumShareSheet: that one shares an album you already have,
 * this one MAKES the album out of whatever is selected in the grid and shares
 * it in the same breath. Both end at `<host>/s/<slug>`.
 *
 * ── Why the name gets its own screen ─────────────────────────────────────
 * It would be quicker to auto-name the album and skip straight to the share
 * sheet. Two reasons not to:
 *
 *   The name is what the RECIPIENT reads. It's the title on the preview card
 *   in their chat thread, so "IMG_5248 and 11 others" is a worse answer than
 *   four seconds of typing.
 *
 *   The name decides WHAT GETS SHARED. Album membership is a tag query
 *   (see services/selectionAlbumLinks.js) — reuse an existing name and the
 *   link publishes every photo already carrying it, not the twelve that were
 *   selected. That is not something to resolve behind the user's back, so the
 *   collision is surfaced inline, as they type, with the real count and a
 *   button that states what it is about to do.
 *
 * CHROME RULE: rendered as an IN-TREE overlay, never a <Modal> — the vault
 * already lives inside one, and a sibling Modal over an open Modal silently
 * fails to show on iOS. Same reasoning, and the same keyboard-lift mechanics,
 * as AlbumShareSheet.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Pressable, ScrollView, StyleSheet,
  Switch, Text, TextInput, View,
} from 'react-native';
import Reanimated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { impactHaptic, notifyHaptic, tapHaptic } from '../../../utils/haptics';
import { useSheetDismiss } from '../../../utils/useSheetDismiss';
import {
  createAlbumLink, findAlbumCollision, loadAlbumIndex, suggestAlbumName, validateAlbumName,
} from '../../../services/selectionAlbumLinks';

export default function SelectionShareLinkSheet({
  visible, items = [], api, theme, onClose, onCreated, bottomInset = 0,
}) {
  const insets = useSafeAreaInsets();
  const rest = Math.max(bottomInset, insets.bottom, 14);
  const keyboard = useAnimatedKeyboard();
  const keyboardLift = useAnimatedStyle(() => {
    'worklet';
    return { transform: [{ translateY: -Math.max(keyboard.height.value - rest, 0) }] };
  });
  const { panHandlers, scrollProps, sheetDragStyle } = useSheetDismiss(onClose, visible);

  const [name, setName] = useState('');
  const [index, setIndex] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [allowDownload, setAllowDownload] = useState(true);
  const [allowUpload, setAllowUpload] = useState(false);

  const count = items.length;
  // Counted honestly: a mixed selection is "items", not "photos". The same
  // rule the server applies to the preview card's description.
  const noun = useMemo(() => {
    const images = items.filter((i) => (i?.type || 'image') === 'image').length;
    const videos = items.filter((i) => i?.type === 'video').length;
    if (images === count) return count === 1 ? 'photo' : 'photos';
    if (videos === count) return count === 1 ? 'video' : 'videos';
    return count === 1 ? 'item' : 'items';
  }, [items, count]);

  // Re-suggest on every open: the selection changes between openings, and a
  // name left over from the last one is worse than no default at all.
  const suggestion = useMemo(() => suggestAlbumName(items), [items]);

  // The index is only for the inline collision check, so a failure to load it
  // must not block sharing — it degrades to "no warning", and the server still
  // does the right thing either way.
  const loadedFor = useRef(null);
  useEffect(() => {
    if (!visible) return undefined;
    setName(suggestion);
    setUsePassword(false);
    setPassword('');
    setAllowDownload(true);
    setAllowUpload(false);
    setError(null);

    let cancelled = false;
    const token = Symbol('load');
    loadedFor.current = token;
    (async () => {
      try {
        const idx = await loadAlbumIndex(api);
        if (!cancelled && loadedFor.current === token) setIndex(idx);
      } catch {
        if (!cancelled && loadedFor.current === token) setIndex({ names: [], counts: {} });
      }
    })();
    return () => { cancelled = true; };
  }, [visible, suggestion, api]);

  const collision = useMemo(
    () => (index ? findAlbumCollision(index, name) : null),
    [index, name],
  );

  const create = useCallback(async () => {
    const problem = validateAlbumName(name);
    if (problem) { setError(problem); return; }
    if (usePassword && password.trim().length < 4) {
      setError('Password must be at least 4 characters.');
      return;
    }
    impactHaptic('medium');
    setBusy(true);
    setError(null);
    try {
      const share = await createAlbumLink(api, {
        ids: items.map((i) => i.id),
        album: name,
        allowDownload,
        allowUpload,
        password: usePassword ? password : undefined,
      });
      notifyHaptic('success');
      onCreated?.(share);
    } catch (e) {
      setError(e?.message || 'Could not create the link');
      notifyHaptic('error');
    } finally {
      setBusy(false);
    }
  }, [api, items, name, allowDownload, allowUpload, usePassword, password, onCreated]);

  if (!visible) return null;
  const s = makeStyles(theme);

  // The button says what it is about to do. On a collision that is not "create
  // a link" — it is "publish someone else's photos too", and the number is the
  // only part of that sentence anyone will actually read.
  const total = collision ? collision.count + count : count;
  const buttonLabel = collision
    ? `Add to “${collision.name}” & share ${total}`
    : 'Create link';

  return (
    <View style={[StyleSheet.absoluteFill, s.backdrop]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <Reanimated.View style={[{ maxHeight: '86%' }, keyboardLift]}>
        <Animated.View
          {...panHandlers}
          style={[s.sheet, { maxHeight: '100%', paddingBottom: rest + 10 }, sheetDragStyle]}
        >
          <View style={s.grabber} />
          <View style={s.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.title} numberOfLines={1}>Share {count} {noun}</Text>
              <Text style={s.subtitle}>
                They’ll open one page in a browser — no account needed.
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
            scrollIndicatorInsets={{ right: 1 }}
            {...scrollProps}
          >
            <Text style={s.sectionLabel}>ALBUM NAME</Text>
            <TextInput
              value={name}
              onChangeText={(v) => { setName(v); setError(null); }}
              placeholder={suggestion}
              placeholderTextColor={theme.colors.textMuted}
              selectTextOnFocus
              returnKeyType="done"
              style={s.input}
              testID="selection-album-name"
            />
            <Text style={s.hint}>
              This is what people will see. It also saves these {count} {noun} as an
              album in your vault.
            </Text>

            {/* The whole reason this sheet exists. Inline rather than a
                confirmation dialog at the end: a warning you can still act on
                beats one that arrives after you've decided. */}
            {!!collision && (
              <View style={s.warnBox}>
                <MaterialCommunityIcons
                  name="alert-outline"
                  size={15}
                  color={theme.colors.accentWarning || '#e0a33e'}
                />
                <Text style={s.warnText}>
                  “{collision.name}” already exists with {collision.count}{' '}
                  {collision.count === 1 ? 'item' : 'items'}. Your link will show
                  all {total} — not just the {count} you picked.
                </Text>
              </View>
            )}

            <View style={s.divider} />

            <View style={s.optionRow}>
              <Text style={s.optionText}>Allow downloading originals</Text>
              <Switch
                value={allowDownload}
                onValueChange={(v) => { tapHaptic(); setAllowDownload(v); }}
                trackColor={{ true: theme.colors.accentInfo }}
              />
            </View>

            <View style={s.optionRow}>
              <Text style={s.optionText}>Require a password</Text>
              <Switch
                value={usePassword}
                onValueChange={(v) => { tapHaptic(); setUsePassword(v); }}
                trackColor={{ true: theme.colors.accentInfo }}
              />
            </View>
            {usePassword && (
              <>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Password for viewers (min 4 characters)"
                  placeholderTextColor={theme.colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={s.input}
                />
                {/* Stated here rather than discovered later: a preview fetcher
                    cannot type a password, so a locked link arrives as a plain
                    grey card with only the album's name on it. */}
                <Text style={s.hint}>
                  A locked link won’t show a preview in chat — just the name.
                </Text>
              </>
            )}

            <View style={s.optionRow}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={[s.optionText, { flex: 0 }]}>Let visitors add to this album</Text>
                <Text style={s.optionHint}>
                  Anyone with the link can upload photos, videos, audio and PDFs.
                </Text>
              </View>
              <Switch
                value={allowUpload}
                onValueChange={(v) => { tapHaptic(); setAllowUpload(v); }}
                trackColor={{ true: theme.colors.accentInfo }}
              />
            </View>

            <Pressable
              onPress={create}
              disabled={busy}
              style={[s.createBtn, busy && { opacity: 0.6 }]}
              testID="selection-album-create"
            >
              {busy
                ? <ActivityIndicator size="small" color={theme.colors.background} />
                : <MaterialCommunityIcons name="link-variant-plus" size={16} color={theme.colors.background} />}
              <Text style={s.createText} numberOfLines={1}>{buttonLabel}</Text>
            </Pressable>
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
  sectionLabel: {
    fontSize: 10, fontWeight: '800', letterSpacing: 0.7, color: theme.colors.textMuted, marginBottom: 6,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, borderRadius: 10,
    paddingHorizontal: 12, height: 44, paddingVertical: 0, textAlignVertical: 'center',
    color: theme.colors.textPrimary, fontSize: 15, backgroundColor: theme.colors.surfaceElevated,
  },
  hint: { fontSize: 11.5, color: theme.colors.textMuted, marginTop: 7, lineHeight: 16 },
  warnBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 7,
    marginTop: 10, padding: 10, borderRadius: 10,
    backgroundColor: 'rgba(224,163,62,0.12)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(224,163,62,0.38)',
  },
  warnText: { flex: 1, fontSize: 12, color: theme.colors.textPrimary, lineHeight: 17 },
  divider: {
    height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border, marginTop: 16,
  },
  optionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8, gap: 12,
  },
  optionText: { fontSize: 14, color: theme.colors.textPrimary, flex: 1 },
  optionHint: { fontSize: 11.5, color: theme.colors.textMuted, marginTop: 2, lineHeight: 15 },
  createBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 16, height: 46, borderRadius: 12, backgroundColor: theme.colors.primary,
    paddingHorizontal: 14,
  },
  createText: { fontSize: 15, fontWeight: '800', color: theme.colors.background, flexShrink: 1 },
});
