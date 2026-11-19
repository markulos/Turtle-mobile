/**
 * AlbumPickerSheet — "put this in an album", the way Photos does it.
 *
 * ─── Albums and tags are the SAME THING here ───────────────────────────────
 *
 * Worth knowing before changing anything in this file: on the pond an album is
 * a registered tag. `PUT /media/:id/tags` and the bulk route both auto-register
 * every new tag into the albums table, so a tag you apply IS an album from
 * then on, and a photo is "in" an album by carrying its name as a tag.
 *
 * That is why this sheet can exist without a single server change — and why it
 * is worth having. The tag editor asks you to think in tags, which is a filing
 * system you have to hold in your head; this asks the one question people
 * actually have about a photo ("which album?") and writes the same row.
 *
 * ─── Why there is no "empty album" ─────────────────────────────────────────
 *
 * Because an album only exists once a tag write has registered it, and the
 * bulk route refuses an empty id list — there is nothing to write a tag ON. So
 * a new album is NAMED here and created the moment it has its first photo,
 * exactly as iOS does it (New Album → name → pick photos → Done). The sheet
 * says so rather than offering a button that silently does nothing.
 *
 * Presentational: it knows the albums it was handed and reports what was
 * chosen. The writing lives with the gallery, which owns the optimistic
 * update and the refresh.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TouchableOpacity,
  useWindowDimensions, View,
} from 'react-native';
import Reanimated, { useAnimatedStyle } from 'react-native-reanimated';
import { useKeyboardFrame } from '../../../utils/keyboardMotion';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AppTextInput from '../../../components/AppTextInput';
import { INPUT_FIELD } from '../../../utils/inputField';
import { TAP_ONLY } from '../../../utils/pressBehavior';
import { tapHaptic } from '../../../utils/haptics';
import { albumSuggestions, isNewAlbumName, cleanAlbumName } from '../../../utils/albumPicker';
import { SCROLL_INDICATOR } from '../../../utils/scrollIndicator';

/**
 * ─── Why the tag editor is a key in HERE ──────────────────────────────────
 *
 * Because they were two keys in the bulk-action bar writing the same row, and
 * a bar that cannot fit on the screen is paying for the choice. This sheet
 * asks the question people actually have, so it leads; the tag editor is the
 * rarer answer — taking a tag OFF, or putting several on at once — and sits
 * behind `onEditTags`. Optional: the caller that has no tag editor to offer
 * simply does not pass one, and no key appears.
 *
 * @param albums     [{ name, count }] — what exists already.
 * @param count      how many photos are being filed, for the title.
 * @param inAlbums   names the photos are ALREADY in, shown ticked.
 * @param onEditTags hand the same items to the full tag editor (optional).
 * @param bottomInset what the CALLER says is under the sheet (a floating tab
 *                    dock), so the footer clears it — see STYLE-RULES §4.
 */
export default function AlbumPickerSheet({
  visible, albums = [], count = 0, inAlbums = [], busy = false,
  onPick, onClose, onEditTags, bottomInset = 0, theme,
}) {
  const c = theme.colors;
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const [query, setQuery] = useState('');

  /**
   * The keyboard lift. The field at the top of this sheet is the whole point
   * of it — you type a name to find or make an album — and the keyboard used
   * to come straight up over the list of matches it was filtering.
   *
   * House rule (STYLE-RULES §4): no KeyboardAvoidingView; a native-driver
   * transform matched to the keyboard, `useAnimatedKeyboard` in-tree. The
   * sheet already rests on `pad` of clearance, so the lift CANCELS exactly
   * that — adding the two leaves the card floating above the keyboard.
   *
   * The height is capped by the same number, because a card that lifts without
   * shrinking takes its own top off the screen.
   */
  const pad = Math.max(insets.bottom, bottomInset);
  const keyboard = useKeyboardFrame();
  const lift = useAnimatedStyle(() => {
    'worklet';
    const up = Math.max(keyboard.height.value - pad, 0);
    return {
      transform: [{ translateY: -up }],
      maxHeight: Math.min(winH * 0.72, winH - up - insets.top - 12),
    };
  });

  const shown = useMemo(() => albumSuggestions(albums, query), [albums, query]);
  const newName = useMemo(() => cleanAlbumName(query), [query]);
  const offersNew = useMemo(() => isNewAlbumName(albums, query), [albums, query]);
  const already = useMemo(() => new Set(inAlbums.map((n) => String(n).toLowerCase())), [inAlbums]);

  const choose = useCallback((name) => {
    tapHaptic();
    setQuery('');
    onPick?.(name);
  }, [onPick]);

  if (!visible) return null;

  const title = count === 1 ? 'Add this photo to…' : `Add ${count} photos to…`;

  return (
    <View style={[StyleSheet.absoluteFill, styles.layer]} pointerEvents="box-none" testID="album-picker">
      <Pressable
        style={[StyleSheet.absoluteFill, styles.scrim]}
        accessibilityLabel="Close"
        onPress={onClose}
      />
      <Reanimated.View style={[styles.sheet, lift, {
        backgroundColor: c.surfaceElevated,
        borderColor: c.border,
        paddingBottom: pad + 10,
      }]}
      >
        <View style={styles.grabWrap}><View style={[styles.grab, { backgroundColor: c.border }]} /></View>

        <View style={styles.headerRow}>
          <Text style={[styles.title, { color: c.textPrimary }]} numberOfLines={1}>{title}</Text>
          {busy ? <ActivityIndicator size="small" color={c.textMuted} /> : null}
          {/* The other half of what the selection bar's one filing key now
              covers. A labelled key rather than a bare icon — it leaves this
              sheet for a different one, and an icon alone would not say so. */}
          {onEditTags ? (
            <TouchableOpacity
              {...TAP_ONLY}
              activeOpacity={0.7}
              onPress={() => { tapHaptic(); onEditTags(); }}
              style={[styles.tagsKey, { borderColor: c.border, backgroundColor: c.surface }]}
              accessibilityRole="button"
              accessibilityLabel="Edit tags instead"
              testID="album-picker-tags"
            >
              <Icon name="tag-multiple" size={15} color={c.accentInk || c.textSecondary} />
              <Text style={[styles.tagsKeyText, { color: c.accentInk || c.textSecondary }]} numberOfLines={1}>
                Tags
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* One field, two jobs: filter what you have, or name what you do not.
            Photos does the same — you type and either tap a match or tap the
            new-album row that appears under it. */}
        <View style={[styles.field, { borderColor: c.border, backgroundColor: c.surface }]}>
          <Icon name="magnify" size={18} color={c.textMuted} />
          {/* AppTextInput, not a raw one: iOS draws a `placeholder` outside
              the app's text pipeline, so under Figtree the field would carry
              two typefaces — one for what you type and the system face for
              the hint. That component is the fix, and a sweep test keeps it
              the only place allowed to hand a placeholder to a TextInput. */}
          <AppTextInput
            style={[styles.input, { color: c.textPrimary }]}
            placeholder="Find or name an album"
            placeholderTextColor={c.textMuted}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={() => { if (offersNew) choose(newName); }}
            testID="album-picker-field"
          />
          {query.length > 0 ? (
            <TouchableOpacity
              onPress={() => setQuery('')}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityLabel="Clear"
            >
              <Icon name="close-circle" size={18} color={c.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>

        {offersNew ? (
          <TouchableOpacity
            {...TAP_ONLY}
            activeOpacity={0.7}
            onPress={() => choose(newName)}
            style={[styles.row, styles.newRow, { borderColor: c.border }]}
            accessibilityRole="button"
            accessibilityLabel={`New album, ${newName}`}
            testID="album-picker-new"
          >
            <View style={[styles.art, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Icon name="plus" size={20} color={c.accentInk || c.textSecondary} />
            </View>
            <View style={styles.body}>
              <Text style={[styles.name, { color: c.textPrimary }]} numberOfLines={1}>
                New album “{newName}”
              </Text>
              <Text style={[styles.meta, { color: c.textTertiary }]} numberOfLines={1}>
                {count === 1 ? 'Created with this photo in it' : `Created with these ${count} photos in it`}
              </Text>
            </View>
          </TouchableOpacity>
        ) : null}

        <FlatList {...SCROLL_INDICATOR}
          data={shown}
          keyExtractor={(a) => a.name}
          style={styles.list}
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: c.border }]} />}
          ListEmptyComponent={(
            <Text style={[styles.empty, { color: c.textTertiary }]}>
              {query.trim()
                ? 'No album by that name yet — the row above makes one.'
                : 'No albums yet. Type a name to make the first one.'}
            </Text>
          )}
          renderItem={({ item }) => {
            const has = already.has(item.name.toLowerCase());
            return (
              <TouchableOpacity
                {...TAP_ONLY}
                activeOpacity={0.7}
                disabled={has}
                onPress={() => choose(item.name)}
                style={[styles.row, has && styles.rowDone]}
                accessibilityRole="button"
                accessibilityLabel={has ? `${item.name}, already in it` : `Add to ${item.name}`}
                testID={`album-pick-${item.name}`}
              >
                <View style={[styles.art, { backgroundColor: c.surface, borderColor: c.border }]}>
                  <Icon name="image-multiple-outline" size={18} color={c.textSecondary} />
                </View>
                <View style={styles.body}>
                  <Text style={[styles.name, { color: c.textPrimary }]} numberOfLines={1}>{item.name}</Text>
                  <Text style={[styles.meta, { color: c.textTertiary }]} numberOfLines={1}>
                    {item.count > 0 ? `${item.count} photo${item.count === 1 ? '' : 's'}` : 'Empty'}
                  </Text>
                </View>
                {/* Already in it: said, not hidden. A photo missing from the
                    list because it is already filed reads as a bug. */}
                {has ? <Icon name="check" size={20} color={c.accentSuccess || c.accentInk} /> : null}
              </TouchableOpacity>
            );
          }}
        />
      </Reanimated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // It opened on a press, so it covers what raised it — the selection bar, the
  // board's page, the headers, the dock (STYLE-RULES §4). 1000 is the app's
  // top band: the tags sheet (ViewerSheet) carries it too, and the one place
  // the two meet hands over by CLOSING this first, so they never stack.
  layer: { zIndex: 1000 },
  scrim: { backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    // The resting cap. The animated style narrows it further while the
    // keyboard is up — see the lift.
    maxHeight: '72%',
    borderTopLeftRadius: 18, borderTopRightRadius: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
  },
  grabWrap: { alignItems: 'center', paddingVertical: 8 },
  grab: { width: 38, height: 4, borderRadius: 2 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 10 },
  title: { flex: 1, fontSize: 17, fontWeight: '700' },
  tagsKey: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, height: 30, borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tagsKeyText: { fontSize: 13, fontWeight: '700' },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: 10,
    paddingHorizontal: 10, height: 40, marginBottom: 10,
  },
  // The app's single-line field metrics, spread rather than written out —
  // utils/inputField is the one definition and a scan keeps it that way.
  input: { flex: 1, fontSize: 15, ...INPUT_FIELD },
  list: { flexGrow: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  rowDone: { opacity: 0.55 },
  newRow: { borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 12, marginBottom: 2 },
  art: {
    width: 40, height: 40, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  body: { flex: 1, minWidth: 0 },
  name: { fontSize: 15.5, fontWeight: '600' },
  meta: { fontSize: 12, marginTop: 1 },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 52, opacity: 0.6 },
  empty: { fontSize: 13, paddingVertical: 18, textAlign: 'center' },
});
