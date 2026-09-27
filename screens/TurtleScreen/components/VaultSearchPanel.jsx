/**
 * VaultSearchPanel — the vault's search, as a PAGE of its own.
 *
 * VaultSearchDock is the in-place version: a page that is already full-screen
 * lifts, its header stands down, and the field rises into the space. That only
 * works when there IS a page to lift. A picker embedded in a form has the
 * opposite problem — it is a 260pt window inside somebody else's ScrollView,
 * fighting the keyboard for what is left, with a nested scroller arguing with
 * the form over every drag. That is why those pickers capped their lists and
 * said "12 more — keep typing": not a choice, a symptom.
 *
 * So this is the same search, pushed rather than lifted. It reuses the dock's
 * actual pieces — VaultResultRow for the rows, the dock's pill geometry for the
 * field — so it is the same search to look at and to use, and the difference is
 * only how it arrives. Given the whole screen, the list simply scrolls and
 * nothing has to be hidden behind a cap.
 *
 * IN-TREE (EdgeSwipePage `overlay`), because every caller is itself inside a
 * page: on iOS a sibling Modal over an open one silently fails to present.
 *
 * The rows are the caller's: `items` + `renderItem`, the FlatList contract, so
 * a board row, a note row and a track row stay each other's business. What is
 * shared is the frame — field, back key, filter chips, empty state.
 */
import React, { useCallback, useEffect, useRef } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, BackHandler, ActivityIndicator, Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AppTextInput from '../../../components/AppTextInput';
import EdgeSwipePage from './EdgeSwipePage';
import { HIT_SLOP_8, ROW_KEY_W, SEARCH_HEIGHT } from './VaultSearchDock';
import { panelBottomInset } from '../../../components/tabBarLayout';

export default function VaultSearchPanel({
  visible,
  placeholder = 'Search',
  accessibilityLabel,
  query,
  onQueryChange,
  onClose,
  onSubmitEditing,
  items,
  renderItem,
  keyExtractor,
  ListHeaderComponent,
  ListFooterComponent,
  filters,
  activeFilter,
  onFilterChange,
  loading = false,
  emptyText = 'Nothing matches that.',
  theme,
  isDark,
  testIDPrefix = 'search-panel',
  // The field's own testID, when a caller already has one its tests use.
  // Defaults to the dock's `<prefix>-input` convention.
  inputTestID,
  // How much room to leave above the field. Defaults to the safe area, which is
  // right for a caller that covers the whole screen — but an `overlay` panel
  // opened INSIDE a page that has already cleared the status bar would then
  // clear it twice, and the notch's worth of nothing above the field is the
  // tell. Such a caller passes 0.
  insetTop,
  // Take the WHOLE screen — the Modal form of EdgeSwipePage rather than the
  // in-tree overlay. `overlay` exists because a caller already inside a page
  // cannot present a sibling Modal on iOS; a caller that is NOT (a tab screen
  // opening a picker from its header) wants the real thing, so that the page it
  // came from goes away entirely instead of being framed by it.
  fullScreen = false,
}) {
  const insets = useSafeAreaInsets();
  const topPad = insetTop == null ? insets.top : insetTop;
  const inputRef = useRef(null);
  const styles = panelStyles(theme, isDark);

  // Focus on the NEXT frame, not on mount: the page is still sliding in, and a
  // keyboard that beats it there arrives before the field it belongs to. Same
  // reasoning as the note composer's delayed focus.
  useEffect(() => {
    if (!visible) return undefined;
    const t = setTimeout(() => inputRef.current?.focus(), 240);
    return () => clearTimeout(t);
  }, [visible]);

  const close = useCallback(() => {
    Keyboard.dismiss();
    onClose?.();
  }, [onClose]);

  // Android back closes the PANEL, not the form underneath it. Registered
  // after the host's own handler (this mounts later), and BackHandler calls the
  // most recent first, so it wins while the panel is up.
  useEffect(() => {
    if (!visible) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { close(); return true; });
    return () => sub.remove();
  }, [visible, close]);

  return (
    <EdgeSwipePage overlay={!fullScreen} visible={visible} onClose={close}>
      <View style={styles.page}>
        <View style={[styles.header, { paddingTop: topPad + 8 }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={close}
            hitSlop={HIT_SLOP_8}
            style={styles.backKey}
            testID={`${testIDPrefix}-cancel`}
          >
            <Icon name="chevron-left" size={28} color={theme.colors.textPrimary} />
          </Pressable>
          {/* The dock's pill, to the point: a hairline-bordered 38pt outline on
              the page's own fill, not a filled surface. */}
          <View style={[styles.field, { borderColor: theme.colors.border }]}>
            <Icon name="magnify" size={21} color={theme.colors.textMuted} />
            <AppTextInput
              ref={inputRef}
              value={query}
              onChangeText={onQueryChange}
              placeholder={placeholder}
              placeholderTextColor={theme.colors.textMuted}
              accessibilityLabel={accessibilityLabel || placeholder}
              // Incremental: filter as you type, and never take the keyboard
              // away mid-word. Autocorrect and caps only get between the user
              // and a name they are already spelling.
              autoCorrect={false}
              autoCapitalize="none"
              spellCheck={false}
              returnKeyType="search"
              blurOnSubmit={false}
              onSubmitEditing={onSubmitEditing}
              clearButtonMode="never"
              style={[styles.fieldInput, { color: theme.colors.textPrimary }]}
              testID={inputTestID || `${testIDPrefix}-input`}
            />
            {loading ? (
              <ActivityIndicator size="small" color={theme.colors.textMuted} />
            ) : query ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear search"
                // Clearing is part of typing, not the end of it — keep the
                // field focused so the user can retype straight away.
                onPress={() => { onQueryChange(''); inputRef.current?.focus(); }}
                style={styles.clear}
              >
                <Icon name="close-circle" size={21} color={theme.colors.textSecondary} />
              </Pressable>
            ) : null}
          </View>
        </View>

        {Array.isArray(filters) && filters.length > 0 && (
          <View style={styles.filterRow}>
            {filters.map((f) => {
              const active = activeFilter === f.key;
              return (
                <Pressable
                  key={f.key}
                  onPress={() => onFilterChange?.(f.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Show ${f.label}`}
                  style={[styles.filterChip, active && styles.filterChipActive]}
                >
                  <Text style={[styles.filterText, active && styles.filterTextActive]}>{f.label}</Text>
                </Pressable>
              );
            })}
          </View>
        )}

        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          ListHeaderComponent={ListHeaderComponent}
          ListFooterComponent={ListFooterComponent}
          // The list is the page, so it takes the drags — no nested-scroller
          // argument to lose, which is the whole reason this is a panel.
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={[
            styles.listContent,
            // Ends ABOVE the dock, never behind it (STYLE-RULES §3). Automatic
            // per caller: an in-tree overlay is covered by the floating bar, a
            // full-screen Modal presents over the whole navigator and is not.
            { paddingBottom: panelBottomInset(insets.bottom, !fullScreen) },
            (!items || items.length === 0) && { flexGrow: 1 },
          ]}
          ListEmptyComponent={(
            <View style={styles.empty}>
              <Text style={styles.emptyText}>{emptyText}</Text>
            </View>
          )}
        />
      </View>
    </EdgeSwipePage>
  );
}

const panelStyles = (theme, isDark) => StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  backKey: { width: ROW_KEY_W, height: 38, alignItems: 'center', justifyContent: 'center' },
  field: {
    height: SEARCH_HEIGHT,
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 19,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    gap: 8,
  },
  fieldInput: { flex: 1, fontSize: 15, height: '100%', padding: 0 },
  clear: { width: 44, height: 44, marginRight: -12, alignItems: 'center', justifyContent: 'center' },
  // Wraps, and each chip may shrink — nothing runs past the panel's edge.
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  filterChip: {
    flexShrink: 1,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  filterChipActive: {
    backgroundColor: theme.colors.accentInfo + (isDark ? '2E' : '1F'),
    borderColor: theme.colors.accentInfo + '66',
  },
  filterText: { fontSize: 13, fontWeight: '600', color: theme.colors.textSecondary },
  filterTextActive: { color: theme.colors.accentInfo },
  listContent: { paddingHorizontal: 16 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyText: { fontSize: 14, color: theme.colors.textTertiary, textAlign: 'center' },
});
