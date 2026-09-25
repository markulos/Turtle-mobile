/**
 * The task form's "Linked note" field, in two halves.
 *
 * They are two components because of WHERE each has to be mounted. The field
 * lives inside the form's ScrollView; the search is an absolutely-positioned
 * page, and an absolute child of scrolling content is positioned against that
 * CONTENT, not the screen. So `NoteLinkPicker` is the field — a chip, or the
 * button that asks for the search — and `NoteSearchPanel` is the search, which
 * the form mounts at page level beside its ScrollView.
 *
 * The search itself is the same three-tier one the Notes screen runs, ranked:
 *
 *   Tier 1 — the loaded page. Instant, and the only tier that works offline.
 *   Tier 2 — GET /turtle/notes/search, debounced. BM25 over FTS5, so it reaches
 *            notes the page never held and prefix-matches each word ("mil"
 *            finds "milk").
 *   Tier 3 — trigram/Dice over GET /turtle/notes/index, and ONLY when the first
 *            two came back empty. This is the typo net; it is last because it
 *            will happily rank something loosely similar, which is the right
 *            answer when nothing matched and noise when something did.
 *
 * Tiers 1 and 2 are merged (deduped by id) and ranked TOGETHER by
 * utils/noteSearch, so the ordering is one judgement rather than "page hits
 * first, then server hits".
 *
 * KNOWN LIMITATION, inherited from the Notes screen's identical fallback: Tier
 * 3 ranks ids over every note in the index, but a row can only be RENDERED for
 * a note object we hold — the loaded page plus the (empty, by definition here)
 * server matches. A fuzzy candidate outside that page ranks and is then
 * dropped. Fixing it needs a fetch-notes-by-id endpoint; at quick-capture
 * scale the page is almost always where the note is.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useServer } from '../../../context/ServerContext';
import { depth } from '../../../utils/surfaceDepth';
import { fuzzyRank } from '../../../utils/trigram';
// The results wear the vault's own search row, and the whole thing arrives as
// the vault's own search page — one search to learn, wherever you meet it.
import VaultSearchPanel from '../../TurtleScreen/components/VaultSearchPanel';
import { VaultResultRow } from '../../TurtleScreen/components/VaultSearchDock';
import { buildQuery, matchSnippet, noteAgeLabel, noteTitleOf, rankNotes } from '../utils/noteSearch';

/** How many notes the browse pool holds. The server FTS covers everything past it. */
const PAGE_LIMIT = 200;
/** Rows rendered. The list scrolls, so this is about ranking honestly, not fitting. */
const RESULT_LIMIT = 40;
/** Long enough that typing a word doesn't fire a request per letter. */
const FTS_DEBOUNCE_MS = 280;

const KINDS = [
  { key: 'all', label: 'All' },
  { key: 'note', label: 'Notes' },
  { key: 'todo', label: 'Todos' },
];

/** The FIELD: what the note-linking row looks like in the form. */
export default function NoteLinkPicker({ value, onClear, onRequestOpen, theme, isDark }) {
  const styles = useMemo(() => pickerStyles(theme, isDark), [theme, isDark]);

  if (value) {
    return (
      <View style={styles.chip}>
        <Icon name="link-variant" size={16} color={theme.colors.accentInfo} />
        <Text style={styles.chipText} numberOfLines={1}>
          Linked to note: {value.title}
        </Text>
        <TouchableOpacity
          onPress={onClear}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Unlink note"
        >
          <Icon name="close-circle" size={18} color={theme.colors.textTertiary} />
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={styles.openBtn}
      onPress={onRequestOpen}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel="Link a note"
    >
      <Icon name="link-plus" size={18} color={theme.colors.accentInfo} />
      <Text style={styles.openBtnText}>Link a note</Text>
    </TouchableOpacity>
  );
}

/**
 * The SEARCH: a pushed page, mounted at the form's page level.
 *
 * It used to be a ~260pt box inside the form, sharing what the keyboard left
 * with a nested scroller that fought the form for every drag — which is why its
 * list was capped. Given the screen, the list simply scrolls.
 */
export function NoteSearchPanel({ visible, onPick, onClose, theme, isDark }) {
  const { api, isConnected } = useServer();
  const styles = useMemo(() => pickerStyles(theme, isDark), [theme, isDark]);

  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');

  const [pageNotes, setPageNotes] = useState([]);
  const [pageLoaded, setPageLoaded] = useState(false);
  const [serverMatches, setServerMatches] = useState([]);
  const [searching, setSearching] = useState(false);
  // The full-text index behind Tier 3. A ref, not state: it is read inside the
  // ranking memo and re-rendering on its arrival would be a wasted pass — the
  // next keystroke picks it up, and it only matters once Tiers 1 and 2 miss.
  const indexRef = useRef([]);
  const indexLoading = useRef(false);

  // The browse pool, fetched the first time the panel is opened rather than on
  // mount: most tasks never link a note, and this is a real request. It is
  // deliberately NOT re-fetched on later opens — it is the same set of notes
  // whichever task is being edited, and the server FTS covers anything newer.
  useEffect(() => {
    if (!visible || pageLoaded) return undefined;
    let alive = true;
    api.get(`/turtle/notes?limit=${PAGE_LIMIT}`)
      .then((res) => {
        if (alive && res?.success && Array.isArray(res.notes)) setPageNotes(res.notes);
      })
      .catch(() => { /* offline — the panel still ranks whatever it has */ })
      .finally(() => { if (alive) setPageLoaded(true); });
    return () => { alive = false; };
  }, [visible, pageLoaded, api]);

  // A fresh open is a fresh search; the fetched page above survives it.
  useEffect(() => {
    if (!visible) { setQuery(''); setKind('all'); setServerMatches([]); setSearching(false); }
  }, [visible]);

  // Tier 2, debounced. Skipped while disconnected so the tiers that CAN answer
  // (the loaded page, and the fuzzy net over an index fetched earlier) aren't
  // waiting behind a request that is going to time out.
  useEffect(() => {
    const q = query.trim();
    if (!visible || !q) { setServerMatches([]); setSearching(false); return undefined; }
    if (!isConnected) { setServerMatches([]); setSearching(false); return undefined; }
    setSearching(true);
    const h = setTimeout(() => {
      api.get(`/turtle/notes/search?q=${encodeURIComponent(q)}`)
        .then((r) => setServerMatches(Array.isArray(r?.notes) ? r.notes : []))
        .catch(() => setServerMatches([]))
        .finally(() => setSearching(false));
    }, FTS_DEBOUNCE_MS);
    return () => clearTimeout(h);
  }, [query, visible, isConnected, api]);

  // Warm the Tier-3 index on the FIRST query rather than on a Tier-1/2 miss, so
  // it loads in parallel with the debounced FTS call and is usually already
  // there by the time the fallback needs it. Same trade the Notes screen makes:
  // this is a slow endpoint, and paying for it on open would tax every task
  // that never searches.
  useEffect(() => {
    if (!visible || !isConnected || !query.trim() || indexLoading.current) return;
    indexLoading.current = true;
    api.get('/turtle/notes/index')
      .then((r) => { indexRef.current = Array.isArray(r?.index) ? r.index : []; })
      // Cleared so a failure is retried on the next keystroke instead of
      // leaving the fuzzy net permanently empty for the rest of the session.
      .catch(() => { indexLoading.current = false; });
  }, [query, visible, isConnected, api]);

  const { rows, fuzzy } = useMemo(() => {
    const q = query.trim();
    const pool = [...pageNotes, ...serverMatches];
    const ranked = rankNotes(pool, q, { limit: RESULT_LIMIT, kind });
    if (!q || ranked.length > 0) return { rows: ranked, fuzzy: false };

    const ids = fuzzyRank(q, indexRef.current);
    if (ids.length === 0) return { rows: [], fuzzy: false };
    const byId = new Map();
    for (const n of pool) if (!byId.has(n.id)) byId.set(n.id, n);
    const close = ids
      .map((id) => byId.get(id))
      .filter(Boolean)
      .filter((n) => kind === 'all' || (n.type === 'todo' ? 'todo' : 'note') === kind)
      .slice(0, RESULT_LIMIT);
    return { rows: close, fuzzy: close.length > 0 };
  }, [pageNotes, serverMatches, query, kind]);

  const q = query.trim();
  // Built once per keystroke, not once per rendered row — it compiles a
  // word-boundary regex per token.
  const prepared = useMemo(() => buildQuery(q), [q]);

  const choose = useCallback((note) => {
    onPick?.({ id: note.id, title: noteTitleOf(note) });
    onClose?.();
  }, [onPick, onClose]);

  const renderRow = useCallback(({ item: n }) => {
    const snippet = matchSnippet(n, prepared);
    const tags = Array.isArray(n.tags) ? n.tags : [];
    // The meta line carries whichever of the two is worth the space: the reason
    // this row matched when the title doesn't show it, otherwise its labels.
    const meta = snippet
      || (tags.length > 0
        ? `${tags.slice(0, 3).map((t) => `#${t}`).join(' ')}${tags.length > 3 ? ` +${tags.length - 3}` : ''}`
        : null);
    return (
      <VaultResultRow
        theme={theme}
        name={noteTitleOf(n)}
        meta={meta}
        accessibilityLabel={`Link ${noteTitleOf(n)}`}
        onPress={() => choose(n)}
        leading={(
          <Icon
            name={n.type === 'todo' ? 'checkbox-marked-circle-outline' : 'note-text-outline'}
            size={20}
            color={n.done ? theme.colors.accentSuccess : theme.colors.textSecondary}
          />
        )}
        trailing={(
          <View style={styles.rowTrailing}>
            <Text style={styles.rowAge}>{noteAgeLabel(n)}</Text>
            <Icon name="link-variant" size={16} color={theme.colors.accentInfo} />
          </View>
        )}
      />
    );
  }, [prepared, theme, styles, choose]);

  const empty = !pageLoaded
    ? 'Loading notes…'
    : q
      ? `Nothing matches “${q}”.`
      : 'No notes yet — write one in the Notes tab.';

  return (
    <VaultSearchPanel
      visible={visible}
      query={query}
      onQueryChange={setQuery}
      onClose={onClose}
      placeholder="Search notes, todos, tags…"
      accessibilityLabel="Search notes"
      // In the field, not over the list: the local hits are already on screen
      // while the server answers, and a spinner across them would claim there
      // is nothing there yet when there is.
      loading={searching}
      filters={KINDS}
      activeFilter={kind}
      onFilterChange={setKind}
      items={rows}
      keyExtractor={(n) => String(n.id)}
      renderItem={renderRow}
      emptyText={empty}
      // Said plainly above the rows rather than left to look like ordinary
      // hits: these did not actually match, and presenting a guess as a hit is
      // how you link the wrong note.
      ListHeaderComponent={fuzzy ? (
        <Text style={styles.fuzzyNote}>No exact match — showing the closest notes.</Text>
      ) : null}
      theme={theme}
      isDark={isDark}
      testIDPrefix="note-search"
    />
  );
}

const pickerStyles = (theme, isDark) => StyleSheet.create({
  // Matches the field styling the rest of TaskForm uses.
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceElevated,
    ...depth(theme, 'control'),
  },
  chipText: {
    flex: 1,
    fontSize: theme.typography.body,
    fontWeight: '600',
    color: theme.colors.textPrimary,
  },
  openBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderStyle: 'dashed',
    backgroundColor: theme.colors.surface,
    ...depth(theme, 'control'),
  },
  openBtnText: {
    fontSize: theme.typography.body,
    fontWeight: '600',
    color: theme.colors.accentInfo,
  },
  // The field, the chips and the row shape come from VaultSearchPanel /
  // VaultResultRow now; only what is specific to a NOTE result is left here.
  fuzzyNote: {
    paddingVertical: 8,
    fontSize: theme.typography.small || 12,
    color: theme.colors.textTertiary,
  },
  rowTrailing: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowAge: { fontSize: 11, color: theme.colors.textMuted },
});
