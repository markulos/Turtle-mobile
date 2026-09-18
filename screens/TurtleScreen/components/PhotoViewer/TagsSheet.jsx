/**
 * TagsSheet — the photo's tags, edited in place. Instagram-comments shape: a
 * page slides up over everything else, a search / add field sits at the TOP,
 * the photo's current tags sit below it as chips you can remove, and the
 * albums you could add follow as chips you can tap. Typing filters the
 * existing tags as you go; return (or the ＋ chip) adds what you typed as a
 * new one. Every add and remove commits IMMEDIATELY through onCommitTags
 * (MediaGallery's optimistic commitTags: local state first, the PUT in the
 * background, reverted on failure) — there is no Save button because there is
 * nothing left to save.
 *
 * The chips render `parseTags(item)` from props, so the optimistic update
 * flows back through the items list rather than living in a second copy here.
 * `Favourites` shows but cannot be removed from this sheet: the heart owns it.
 *
 * Two callers: the viewer (one photo: `item` + `onCommitTags(id, next)`) and
 * the grid's selection bar (many photos: `tags` = the tags they all share +
 * `onChange(next)`; the gallery turns the difference into add/remove for the
 * whole selection). Same sheet, same chips, same immediate commits.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import AppTextInput from '../../../../components/AppTextInput';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { FAVOURITES_TAG, parseTags } from '../../../../utils/viewerFormat';
import ViewerSheet, { sheetColors } from './ViewerSheet';

const SYSTEM_TAGS = new Set(['All', FAVOURITES_TAG]);

/** Trim, drop empties, keep first occurrences (case-sensitive, like the server). */
export function mergeTags(current, additions) {
  const out = [...current];
  for (const raw of additions) {
    const t = String(raw || '').trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** Existing tags matching the query (case-insensitive), best matches first. */
export function matchTags(candidates, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return candidates;
  return candidates
    .map((name) => ({ name, at: name.toLowerCase().indexOf(q) }))
    .filter(({ at }) => at >= 0)
    .sort((a, b) => a.at - b.at || a.name.localeCompare(b.name))
    .map(({ name }) => name);
}

export default function TagsSheet({
  item,
  tags: tagsProp,
  suggestions = [],
  onCommitTags,
  onChange,
  onClose,
  theme,
  dark = true,
  title = 'Tags',
  subtitle,
  bottomInset = 0,
  /** A fixed row under the chips (e.g. an Upload button). */
  footer,
  /** Done button: its label and, when set, its own action (see ViewerSheet). */
  doneLabel,
  onDone,
}) {
  const tags = useMemo(() => (Array.isArray(tagsProp) ? tagsProp : parseTags(item)), [tagsProp, item]);
  const [draft, setDraft] = useState('');
  const colors = sheetColors(theme, dark);

  const commit = useCallback((next) => {
    if (Array.isArray(tagsProp)) { onChange?.(next); return; }
    if (!item?.id) return;
    onCommitTags?.(item.id, next);
  }, [tagsProp, onChange, item?.id, onCommitTags]);

  const add = useCallback((raw) => {
    const next = mergeTags(tags, Array.isArray(raw) ? raw : [raw]);
    setDraft('');
    if (next.length !== tags.length) commit(next);
  }, [tags, commit]);

  const remove = useCallback((tag) => {
    if (tag === FAVOURITES_TAG) return;
    commit(tags.filter((t) => t !== tag));
  }, [tags, commit]);

  const handleChange = useCallback((text) => {
    // A comma boxes what was typed, like the composer always did.
    if (text.includes(',')) {
      const parts = text.split(',').map((t) => t.trim()).filter(Boolean);
      const tail = text.endsWith(',') ? '' : parts.pop() || '';
      if (parts.length) add(parts);
      setDraft(tail);
      return;
    }
    setDraft(text);
  }, [add]);

  const submit = useCallback(() => {
    if (draft.trim()) add(draft);
  }, [draft, add]);

  const available = useMemo(
    () => suggestions.filter((s) => s && !SYSTEM_TAGS.has(s) && !tags.includes(s)),
    [suggestions, tags],
  );
  const query = draft.trim();
  const matches = useMemo(() => matchTags(available, query), [available, query]);
  const alreadyOn = useMemo(() => matchTags(tags, query), [tags, query]);
  const exactExists = query.length > 0
    && (available.some((s) => s.toLowerCase() === query.toLowerCase())
      || tags.some((s) => s.toLowerCase() === query.toLowerCase()));
  const canSend = query.length > 0;

  const composer = (
    <View style={[styles.composer, { borderBottomColor: colors.border }]}>
      <Icon name="magnify" size={20} color={colors.textMuted} />
      {/* Fixed-height pill CENTRING an auto-height input: the placeholder and
          caret sit on the pill's centre line on both platforms. */}
      <View style={[styles.inputWrap, { backgroundColor: colors.surface }]}>
        <AppTextInput
          style={[styles.inputInner, { color: colors.textPrimary }]}
          value={draft}
          onChangeText={handleChange}
          onSubmitEditing={submit}
          placeholder="Search or add a tag…"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="done"
          blurOnSubmit={false}
          accessibilityLabel="Search or add a tag"
          testID="tags-input"
        />
      </View>
      <Pressable
        onPress={submit}
        disabled={!canSend}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Add tag"
        testID="tags-send"
        style={({ pressed }) => [styles.send, pressed && styles.pressed]}
      >
        <Icon name="plus-circle" size={30} color={canSend ? colors.primary : colors.textMuted} />
      </Pressable>
    </View>
  );

  const chip = (tag, { onPress, locked = false, ghost = false, icon = null, testID }) => (
    <Pressable
      key={tag}
      onPress={onPress}
      disabled={locked}
      accessibilityRole="button"
      accessibilityLabel={locked ? tag : (ghost ? `Add ${tag}` : `Remove ${tag}`)}
      testID={testID}
      style={({ pressed }) => [
        styles.chip,
        ghost ? [styles.chipGhost, { borderColor: colors.chipGhostBorder }] : { backgroundColor: colors.chip },
        pressed && styles.pressed,
      ]}
    >
      {!!icon && <Icon name={icon} size={14} color={ghost ? colors.chipGhostText : colors.chipText} />}
      <Text style={[styles.chipText, { color: ghost ? colors.chipGhostText : colors.chipText }]} numberOfLines={1}>{tag}</Text>
      {!locked && !ghost && <Icon name="close-circle" size={16} color={colors.chipText} />}
    </Pressable>
  );

  return (
    <ViewerSheet title={title} subtitle={subtitle} bottomInset={bottomInset} onClose={onClose} onDone={onDone} doneLabel={doneLabel || 'Done'} theme={theme} dark={dark} keyboard topBar={composer} footer={footer} testID="tags-sheet">
      {query.length > 0 ? (
        <>
          {!exactExists && (
            <>
              <Text style={[styles.section, { color: colors.textSecondary }]}>New tag</Text>
              <View style={styles.wrap}>
                {chip(query, { onPress: submit, ghost: true, icon: 'plus', testID: 'tag-create' })}
              </View>
            </>
          )}
          <Text style={[styles.section, { color: colors.textSecondary }]}>Matching</Text>
          <View style={styles.wrap}>
            {matches.length === 0 && alreadyOn.length === 0 && (
              <Text style={[styles.empty, { color: colors.textMuted }]}>No existing tag matches</Text>
            )}
            {alreadyOn.map((tag) => chip(tag, { onPress: () => remove(tag), locked: tag === FAVOURITES_TAG, testID: `tag-chip-${tag}` }))}
            {matches.map((tag) => chip(tag, { onPress: () => add(tag), ghost: true, icon: 'plus', testID: `tag-suggest-${tag}` }))}
          </View>
        </>
      ) : (
        <>
          <Text style={[styles.section, { color: colors.textSecondary }]}>On this photo</Text>
          <View style={styles.wrap}>
            {tags.length === 0 && (
              <Text style={[styles.empty, { color: colors.textMuted }]}>No tags yet</Text>
            )}
            {tags.map((tag) => chip(tag, { onPress: () => remove(tag), locked: tag === FAVOURITES_TAG, testID: `tag-chip-${tag}` }))}
          </View>

          {available.length > 0 && (
            <>
              <Text style={[styles.section, { color: colors.textSecondary }]}>Add to album</Text>
              <View style={styles.wrap}>
                {available.map((tag) => chip(tag, { onPress: () => add(tag), ghost: true, icon: 'plus', testID: `tag-suggest-${tag}` }))}
              </View>
            </>
          )}
        </>
      )}
    </ViewerSheet>
  );
}

const styles = StyleSheet.create({
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 4,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 4,
  },
  inputWrap: {
    flex: 1,
    height: 40,
    borderRadius: 20,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  inputInner: {
    paddingVertical: 0,
    paddingTop: 0,
    paddingBottom: 0,
    fontSize: 15,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  send: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: 12,
    marginBottom: 10,
  },
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  empty: {
    fontSize: 14,
    paddingVertical: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 18,
    maxWidth: '100%',
    flexShrink: 1,
  },
  chipGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.6,
  },
});
