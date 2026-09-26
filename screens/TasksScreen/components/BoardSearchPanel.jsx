/**
 * Picking (or naming) a task's board, as a page.
 *
 * This was an in-card list under the Board chip, and it carried the scars of
 * living inside the form's ScrollView: eight boards shown, then a "12 more —
 * keep typing to narrow it down" line. That line was never a feature. A nested
 * scroller inside the form fights it for every drag, so the list could not
 * scroll, so it had to be capped, so a board you owned could be un-reachable
 * without guessing letters of its name.
 *
 * As a pushed page it simply scrolls, and every board is one flick away. It is
 * the vault's search page (VaultSearchPanel) wearing the vault's search rows
 * (VaultResultRow), so it is the same search as the one on the Boards tab.
 *
 * The field is still the FILTER and the new board's NAME at once, which is the
 * property worth protecting: picking an existing board and making a new one are
 * the same gesture — type, then tap the row you meant.
 */
import React, { useCallback, useMemo } from 'react';
import { Text, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import VaultSearchPanel from '../../TurtleScreen/components/VaultSearchPanel';
import { VaultResultRow } from '../../TurtleScreen/components/VaultSearchDock';
import { tapHaptic } from '../../../utils/haptics';

/** Sentinel rows: they are not boards, so they cannot be keyed by name. */
const CREATE = '__create__';
const NONE = '__none__';

export default function BoardSearchPanel({
  visible, query, onQueryChange, onClose, onPick, projects, selected, theme, isDark,
}) {
  const styles = useMemo(() => boardPanelStyles(theme), [theme]);
  const q = String(query || '').trim();

  // Substring, case-insensitive: typing "cons" finds "Mayfield Construction",
  // which a prefix match would not.
  const matches = useMemo(() => {
    const list = Array.isArray(projects) ? projects : [];
    if (!q) return list;
    const needle = q.toLowerCase();
    return list.filter((p) => p.toLowerCase().includes(needle));
  }, [projects, q]);

  // Offer creation only for a name nobody has used: an exact, case-insensitive
  // match means "pick that one", not "make a second one".
  const canCreate = !!q && !(projects || []).some((p) => p.toLowerCase() === q.toLowerCase());

  const rows = useMemo(() => [
    // The name you just typed, first — where it is easiest to act on.
    ...(canCreate ? [{ key: CREATE }] : []),
    ...matches.map((p) => ({ key: p, name: p })),
    // Always last: the answer for "not now".
    { key: NONE },
  ], [canCreate, matches]);

  const pick = useCallback((name) => {
    tapHaptic();
    onPick?.(name);
  }, [onPick]);

  const renderRow = useCallback(({ item }) => {
    if (item.key === CREATE) {
      return (
        <VaultResultRow
          theme={theme}
          name={`Create “${q}”`}
          meta="New board"
          accessibilityLabel={`Create board ${q}`}
          testID="board-option-create"
          onPress={() => pick(q)}
          leading={<Icon name="plus" size={20} color={theme.colors.accentInfo} />}
        />
      );
    }
    if (item.key === NONE) {
      const active = !selected;
      return (
        <VaultResultRow
          theme={theme}
          name="No board — later"
          accessibilityLabel="No board, choose later"
          accessibilityState={{ selected: active }}
          testID="board-option-none"
          onPress={() => pick('')}
          leading={(
            <Icon
              name="folder-off-outline"
              size={20}
              color={active ? theme.colors.accentInfo : theme.colors.textMuted}
            />
          )}
          trailing={active ? <Icon name="check" size={18} color={theme.colors.accentInfo} /> : null}
        />
      );
    }
    const active = selected === item.name;
    return (
      <VaultResultRow
        theme={theme}
        name={item.name}
        accessibilityLabel={item.name}
        accessibilityState={{ selected: active }}
        testID={`board-option-${item.name}`}
        onPress={() => pick(item.name)}
        leading={(
          <Icon
            name={active ? 'folder' : 'folder-outline'}
            size={20}
            color={active ? theme.colors.accentInfo : theme.colors.textMuted}
          />
        )}
        trailing={active ? <Icon name="check" size={18} color={theme.colors.accentInfo} /> : null}
      />
    );
  }, [theme, q, selected, pick]);

  return (
    <VaultSearchPanel
      visible={visible}
      query={query}
      onQueryChange={onQueryChange}
      onClose={onClose}
      placeholder="Search boards, or type a new name"
      accessibilityLabel="Search boards"
      testIDPrefix="board"
      inputTestID="board-search"
      // Enter takes the obvious answer: the first match if there is one,
      // otherwise the board you have just named.
      onSubmitEditing={() => {
        if (matches.length > 0) pick(matches[0]);
        else if (canCreate) pick(q);
      }}
      items={rows}
      keyExtractor={(r) => r.key}
      renderItem={renderRow}
      // Unreachable in practice — the "No board" row is always present — but a
      // list component with no empty state is a blank screen waiting to happen.
      emptyText="No boards yet — type a name to make one."
      ListHeaderComponent={!q && (projects || []).length === 0 ? (
        <Text style={styles.hint}>No boards yet — type a name to make one.</Text>
      ) : null}
      theme={theme}
      isDark={isDark}
    />
  );
}

const boardPanelStyles = (theme) => StyleSheet.create({
  hint: {
    paddingVertical: 10,
    fontSize: theme.typography.small || 13,
    color: theme.colors.textTertiary,
  },
});
