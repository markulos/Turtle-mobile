/**
 * GlobalSearchPage — ONE search box for everything: boards, tasks, notes,
 * photos. Opens from the chat header's magnifier (and the `/search` command)
 * as an EdgeSwipePage overlay; the field sits at the TOP (house rule), the
 * results below in four sections. Everything-style: typing fans out to the
 * server's FTS endpoints (services/globalSearch) after a short debounce and
 * prefix hits lead each section. A tap hands the hit to `onOpen` as an
 * open-target ({ kind, id, item }); the owning tab opens it as its own tap
 * would.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import EdgeSwipePage from './EdgeSwipePage';
import { useServer } from '../../../context/ServerContext';
import { useTheme } from '../../../context/ThemeContext';
import { tapHaptic } from '../../../utils/haptics';
import { searchEverything, stripMarks } from '../../../services/globalSearch';

const DEBOUNCE_MS = 250;
const THUMB_COLS = 3;

const firstLine = (s) => String(s || '').split('\n')[0].trim();
const dueLabel = (t) => {
  const parts = [];
  if (t.project) parts.push(t.project);
  if (t.dueDate) parts.push(t.dueDate);
  if (t.time) parts.push(t.time);
  return parts.join(' · ');
};

export default function GlobalSearchPage({ visible, initialQuery = '', onClose, onOpen }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const insets = useSafeAreaInsets();
  const { api, getBaseUrl, getMediaBaseUrl } = useServer();
  const mediaBase = (getMediaBaseUrl ? getMediaBaseUrl() : getBaseUrl()).replace(/\/api$/, '');
  const thumbUrl = useCallback((m) => {
    const p = m?.thumbnailUrl || m?.compressedUrl || m?.rawUrl;
    if (!p) return null;
    return /^https?:/i.test(p) ? p : mediaBase + p;
  }, [mediaBase]);

  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const boardsRef = useRef([]);
  const seqRef = useRef(0);

  // Board names once per open — matched locally as you type.
  useEffect(() => {
    if (!visible) return undefined;
    let alive = true;
    api.get('/projects')
      .then((r) => { if (alive && Array.isArray(r)) boardsRef.current = r; })
      .catch(() => {});
    return () => { alive = false; };
  }, [visible, api]);

  // Open: take the handed query, focus a frame late (the page is animating in).
  useEffect(() => {
    if (!visible) return undefined;
    setQuery(initialQuery || '');
    setResults(null);
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [visible, initialQuery]);

  // Debounced fan-out; a late response for an older query is dropped.
  useEffect(() => {
    if (!visible) return undefined;
    const q = query.trim();
    if (!q) { setResults(null); setLoading(false); return undefined; }
    const mine = ++seqRef.current;
    setLoading(true);
    const t = setTimeout(async () => {
      const r = await searchEverything(api, q, { boards: boardsRef.current });
      if (mine !== seqRef.current) return;
      setResults(r);
      setLoading(false);
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [visible, query, api]);

  const pick = useCallback((kind, id, item) => {
    tapHaptic();
    Keyboard.dismiss();
    onOpen?.({ kind, id, item });
  }, [onOpen]);

  const total = results ? results.boards.length + results.tasks.length + results.notes.length + results.media.length + results.documents.length : 0;
  const styles = useMemo(() => makeStyles(c), [c]);

  const section = (title, count) => (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionCount}>{count}</Text>
    </View>
  );

  return (
    <EdgeSwipePage overlay visible={visible} onClose={onClose}>
      <View style={[styles.page, { paddingTop: insets.top + 6 }]} testID="global-search">
        {/* Search field on TOP — the page's one job. */}
        <View style={styles.topRow}>
          <View style={styles.field}>
            <Icon name="magnify" size={18} color={c.accentInfo} />
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={query}
              onChangeText={setQuery}
              placeholder="Search tasks, notes, photos, boards"
              placeholderTextColor={c.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              clearButtonMode="never"
              accessibilityLabel="Search everything"
              testID="global-search-input"
            />
            {query.length > 0 && (
              <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
                <Icon name="close-circle" size={18} color={c.textTertiary} />
              </Pressable>
            )}
          </View>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close search" style={styles.cancel} testID="global-search-close">
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>

        <ScrollView
          style={styles.body}
          contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          scrollIndicatorInsets={{ right: 1 }}
          indicatorStyle={theme.mode === 'dark' ? 'white' : 'default'}
        >
          {!query.trim() && (
            <View style={styles.hint}>
              <Icon name="text-search" size={34} color={c.textTertiary} />
              <Text style={styles.hintText}>One box for everything: a task, a note, a photo's tag or text, a board.</Text>
            </View>
          )}

          {!!query.trim() && results && total === 0 && !loading && (
            <View style={styles.hint}>
              <Text style={styles.hintText}>No matches for “{results.query}”</Text>
              {results.errors.length > 0 && (
                <Text style={styles.hintSub}>Could not reach: {results.errors.join(', ')}</Text>
              )}
            </View>
          )}

          {loading && !results && (
            <View style={styles.hint}><ActivityIndicator color={c.textTertiary} /></View>
          )}

          {results && results.boards.length > 0 && (
            <>
              {section('Boards', results.boards.length)}
              <View style={styles.chips}>
                {results.boards.map((name) => (
                  <Pressable
                    key={name}
                    onPress={() => pick('board', name, { name })}
                    style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel={`Open board ${name}`}
                    testID={`search-board-${name}`}
                  >
                    <Icon name="view-dashboard-outline" size={15} color={c.background} />
                    <Text style={styles.chipText} numberOfLines={1}>{name}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          {results && results.tasks.length > 0 && (
            <>
              {section('Tasks', results.tasks.length)}
              {results.tasks.map((t) => (
                <Pressable
                  key={t.id}
                  onPress={() => pick('task', t.id, t)}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`Open task ${t.title}`}
                  testID={`search-task-${t.id}`}
                >
                  <Icon name={t.completed ? 'check-circle' : 'checkbox-blank-circle-outline'} size={20} color={t.completed ? c.accentSuccess : c.textSecondary} />
                  <View style={styles.rowText}>
                    <Text style={[styles.rowTitle, t.completed && styles.done]} numberOfLines={1}>{stripMarks(t.title)}</Text>
                    {!!dueLabel(t) && <Text style={styles.rowSub} numberOfLines={1}>{dueLabel(t)}</Text>}
                  </View>
                </Pressable>
              ))}
            </>
          )}

          {results && results.notes.length > 0 && (
            <>
              {section('Notes', results.notes.length)}
              {results.notes.map((n) => (
                <Pressable
                  key={n.id}
                  onPress={() => pick('note', n.id, n)}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${n.type === 'todo' ? 'to-do' : 'note'} ${firstLine(n.content)}`}
                  testID={`search-note-${n.id}`}
                >
                  <Icon name={n.type === 'todo' ? (n.done ? 'checkbox-marked-outline' : 'checkbox-blank-outline') : 'note-text-outline'} size={20} color={c.textSecondary} />
                  <View style={styles.rowText}>
                    <Text style={[styles.rowTitle, n.done && styles.done]} numberOfLines={1}>{firstLine(n.content) || 'Untitled'}</Text>
                    {Array.isArray(n.tags) && n.tags.length > 0 && (
                      <Text style={styles.rowSub} numberOfLines={1}>{n.tags.join(' · ')}</Text>
                    )}
                  </View>
                </Pressable>
              ))}
            </>
          )}

          {results && results.media.length > 0 && (
            <>
              {section('Photos', results.media.length)}
              <View style={styles.grid}>
                {results.media.map((m) => {
                  const uri = thumbUrl(m);
                  return (
                    <Pressable
                      key={m.id}
                      onPress={() => pick('media', m.id, m)}
                      style={({ pressed }) => [styles.cell, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel={`Open photo ${m.originalName || m.filename || ''}`}
                      testID={`search-media-${m.id}`}
                    >
                      {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={80} /> : null}
                      {m.type === 'video' && (
                        <View style={styles.playBadge}><Icon name="play" size={14} color="#fff" /></View>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

          {results && results.documents?.length > 0 && (
            <>
              {section('Files', results.documents.length)}
              {results.documents.map((d) => (
                <Pressable key={d.id} onPress={() => pick('document', d.id, d)} style={({ pressed }) => [styles.docRow, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={`Open file ${d.originalName || d.filename || ''}`} testID={`search-doc-${d.id}`}>
                  <Icon name="file-document-outline" size={20} color={c.textSecondary} />
                  <Text style={styles.docName} numberOfLines={1}>{d.originalName || d.filename}</Text>
                </Pressable>
              ))}
            </>
          )}
        </ScrollView>
      </View>
    </EdgeSwipePage>
  );
}

const makeStyles = (c) => StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: c.background,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 42,
    borderRadius: 11,
    paddingHorizontal: 12,
    backgroundColor: c.surfaceHighlight,
  },
  input: {
    flex: 1,
    height: 42,
    paddingVertical: 0,
    textAlignVertical: 'center',
    fontSize: 15,
    color: c.textPrimary,
  },
  cancel: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  cancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: c.accentInfo,
  },
  body: {
    flex: 1,
  },
  hint: {
    alignItems: 'center',
    gap: 10,
    paddingTop: 48,
    paddingHorizontal: 32,
  },
  hintText: {
    fontSize: 14,
    color: c.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  hintSub: {
    fontSize: 12,
    color: c.textTertiary,
    textAlign: 'center',
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: c.textSecondary,
  },
  sectionCount: {
    fontSize: 12,
    fontWeight: '600',
    color: c.textTertiary,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: c.primary,
    maxWidth: '100%',
    flexShrink: 1,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
    color: c.background,
    flexShrink: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  rowText: {
    flex: 1,
    flexShrink: 1,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: c.textPrimary,
    flexShrink: 1,
  },
  rowSub: {
    fontSize: 12,
    color: c.textTertiary,
    marginTop: 2,
    flexShrink: 1,
  },
  done: {
    textDecorationLine: 'line-through',
    color: c.textTertiary,
  },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 16,
  },
  docName: {
    color: c.textPrimary,
    fontSize: 14.5,
    flexShrink: 1,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 2,
    paddingHorizontal: 16,
  },
  cell: {
    width: `${Math.floor(100 / THUMB_COLS) - 0.5}%`,
    aspectRatio: 1,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: c.surfaceHighlight,
  },
  playBadge: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
});
