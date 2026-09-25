/**
 * VaultSearchDock — the vault's ONE search surface: the pill that rises to the
 * top of the screen, the back key that slides in beside it, the trailing key it
 * slides over, and the rows that replace the page underneath.
 *
 * It was the Boards page's, and only the Boards page's. Files had a different
 * answer to the same question — a `+` in the toolbar opening a modal sheet with
 * a name field in it — which meant two vault tabs with two ways of finding and
 * making things, neither of which taught you the other. This file is the
 * Boards construction lifted out whole, so the two tabs are not "consistent"
 * by anybody remembering to keep them so: they are the same component.
 *
 * What lives here is everything that is the same wherever it is used — the
 * geometry, the timings, the lift, the freeze-on-exit, the row shape. What does
 * NOT live here is what each page is searching: its own list, its own rows, its
 * own idea of what an empty query means. Those stay with the page.
 *
 * The lift is a TRANSFORM and the wrapper carries a permanent `marginBottom:
 * -lift`, so it is already that much taller than the screen and nothing in it
 * ever relayouts. A padding animation would run a full layout pass over the
 * page on every frame, which is precisely the jank this exists to avoid.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AppTextInput from '../../../components/AppTextInput';
import { TAP_ONLY_PRESSABLE } from '../../../utils/pressBehavior';

// ── The search transition's timings ─────────────────────────────────────────
// Exported because MORE than one thing moves on them: the page lifts, and the
// vault header above it slides away (MediaGallery). They are one movement seen
// in several components, so they cannot each own a copy of the numbers — the
// moment those disagree you get the header and the field arriving separately.
//
// Both curves DECELERATE into rest (ease-out, not ease-in): the element is
// settling into a position, and a curve that accelerates into the end is what
// makes a close feel like a snap rather than a close. Out is shorter than in —
// leaving a search is a dismissal, and a slow one feels like the app arguing.
export const SEARCH_ENTER = { duration: 280, easing: Easing.out(Easing.cubic) };
export const SEARCH_EXIT = { duration: 240, easing: Easing.out(Easing.cubic) };

/** The pill's height, shared by the field and by the placeholder's lineHeight. */
export const SEARCH_HEIGHT = 38;
/**
 * Breathing room between the tab picker in the fixed header above and the
 * field. `topInset` only clears the header's height, so without this the field
 * sits flush against the tab underline.
 */
export const PICKER_GAP = 14;
/**
 * The trailing key's width and the row's gap. Searching hands that space to the
 * field on the right and takes the same amount back on the left for the back
 * key, so the field's WIDTH never changes — it only moves.
 */
export const ROW_KEY_W = 44;
export const ROW_GAP = 10;
export const SEARCH_SHIFT = ROW_KEY_W + ROW_GAP;
/**
 * Restores the 44 pt accessible target for controls whose VISIBLE height is
 * smaller — the reference's proportions without giving up hit area.
 */
export const HIT_SLOP_8 = { top: 8, bottom: 8, left: 8, right: 8 };
/**
 * The result row's leading square. A row is ~62 pt tall, so ~14 of them fit a
 * screen against a grid's 4 — which is the whole point of the mode.
 */
export const ROW_COVER = 46;

/**
 * useVaultSearch — the mode, the lift, and the exit glide.
 *
 * `items` is whatever the page is currently showing; it comes back as
 * `displayItems`, which differs from it only during a cancel (see below).
 *
 * WHAT IS ON SCREEN and WHAT THE PARENT HOLDS part company during that cancel,
 * on purpose, and it is the whole reason the close reads smoothly. Clearing the
 * query is EXPENSIVE and none of the cost belongs to the animation: the parent
 * re-renders and rebuilds every model from the filtered set back to the full
 * one. Done in the animation's completion callback, all of that piles onto the
 * single frame the page lands on, and that long frame is the stutter. So the
 * query is cleared on the FIRST frame and `exitSnapshot` holds the rows and the
 * field text the user is still looking at, so the screen does not change while
 * the page glides. The work happens DURING the glide, where it is free — both
 * halves are `useNativeDriver`, so a busy JS thread cannot touch them.
 *
 * (Clearing early WITHOUT the snapshot is the other obvious version, and it is
 * why the callback looked like the fix: the rows swap back on frame one and you
 * watch a page slide down already showing something else.)
 */
export function useVaultSearch({ query, items, onQueryChange, onSearchActiveChange, lift }) {
  const inputRef = useRef(null);
  // Focus is half the mode on purpose — tapping the field is the moment you
  // want the room, not the first keystroke — and the query is the other half,
  // so the mode survives the keyboard being dismissed with results on screen.
  const [focused, setFocused] = useState(false);
  const [exitSnapshot, setExitSnapshot] = useState(null);
  const exiting = exitSnapshot !== null;
  const searching = focused || !!query || exiting;
  const displayQuery = exiting ? exitSnapshot.query : query;
  const displayItems = exiting ? exitSnapshot.items : items;

  const liftAnim = useRef(new Animated.Value(0)).current;
  // Invalidates a cancel that is still gliding. Tap the field again before it
  // lands and the pending "put the page back" must not fire into the search you
  // have just reopened.
  const cancelRunRef = useRef(0);
  // Where liftAnim has already been SENT. cancelSearch drives the exit itself,
  // so without this the effect below fires a second, identical 0→0 timing the
  // moment `searching` catches up.
  const liftTargetRef = useRef(0);

  // Entering. Leaving does NOT go through here — cancelSearch drives its own
  // animation so it can clear the query on the way OUT. This still catches an
  // exit the caller made some other way.
  useEffect(() => {
    onSearchActiveChange?.(searching);
    const target = searching ? 1 : 0;
    if (liftTargetRef.current === target) return;
    liftTargetRef.current = target;
    Animated.timing(liftAnim, {
      toValue: target,
      ...(searching ? SEARCH_ENTER : SEARCH_EXIT),
      useNativeDriver: true,
    }).start();
  }, [searching, liftAnim, onSearchActiveChange]);

  /**
   * Cancel: keyboard down, page down, header back — then the results go.
   *
   * The keyboard goes first and on its own: iOS dismisses over about the same
   * quarter-second, so starting it on this frame means it lands with the page
   * instead of lingering under a page that has already parked.
   */
  const cancelSearch = useCallback(() => {
    Keyboard.dismiss();
    inputRef.current?.blur();
    setFocused(false);
    // The header starts coming back NOW, with the page — it is the other half
    // of the same movement, and it must not wait for anything else.
    onSearchActiveChange?.(false);
    setExitSnapshot({ items, query });
    onQueryChange('');
    liftTargetRef.current = 0;
    const run = ++cancelRunRef.current;
    Animated.timing(liftAnim, { toValue: 0, ...SEARCH_EXIT, useNativeDriver: true })
      .start(({ finished }) => {
        if (finished && cancelRunRef.current === run) setExitSnapshot(null);
      });
  }, [onQueryChange, onSearchActiveChange, liftAnim, items, query]);

  // Clearing is part of typing, not the end of it — keep the field focused so
  // the keyboard stays up and the user can retype immediately.
  const clearSearch = useCallback(() => {
    onQueryChange('');
    inputRef.current?.focus();
  }, [onQueryChange]);

  // Re-focusing mid-glide takes the exit back: bump the run so the landing
  // callback is a no-op, and drop the frozen copy so the field and the rows
  // follow the live query again.
  const onFocus = useCallback(() => {
    cancelRunRef.current += 1;
    setExitSnapshot(null);
    setFocused(true);
  }, []);

  /** Open the field from somewhere else — the trailing key, an empty state. */
  const beginSearch = useCallback(() => {
    setFocused(true);
    inputRef.current?.focus();
  }, []);

  return {
    inputRef,
    searching,
    displayQuery,
    displayItems,
    cancelSearch,
    clearSearch,
    onFocus,
    beginSearch,
    // All of these ride ONE animated value, so the row moves as a single piece
    // with the page it sits on, on the same curve, driven natively.
    liftStyle: {
      transform: [{ translateY: liftAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -lift] }) }],
    },
    // The field keeps its browsing WIDTH throughout and simply translates right
    // by the slot it is given back on the other side. That is why the trailing
    // key stays mounted: the moment it unmounts, a flex:1 field grows into the
    // space and the whole row relayouts mid-animation, which no transform can
    // smooth over.
    fieldStyle: {
      transform: [{ translateX: liftAnim.interpolate({ inputRange: [0, 1], outputRange: [0, SEARCH_SHIFT] }) }],
    },
    // The key LEADS the field in slightly rather than appearing at its final
    // place — it reads as arriving with the field rather than blinking on.
    backStyle: {
      opacity: liftAnim,
      transform: [{ translateX: liftAnim.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) }],
    },
    trailingStyle: { opacity: liftAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) },
  };
}

/**
 * The dock row itself: back key, pill, trailing key.
 *
 * The back key is ABSOLUTELY positioned in the slot the field slides off, so it
 * costs the row no layout — everything here moves by transform and the row
 * never re-measures. Its `pointerEvents` are tied to `searching` because while
 * browsing it sits invisible OVER the field's magnifier and would otherwise eat
 * the tap that opens search.
 */
export function VaultSearchDock({
  search, theme, placeholder, accessibilityLabel, cancelLabel, clearLabel,
  trailingIcon, trailingLabel, onTrailingPress, onChangeText, onSubmitEditing,
  returnKeyType = 'search', testIDPrefix = 'vault-search',
}) {
  const { searching, displayQuery, inputRef, cancelSearch, clearSearch, onFocus } = search;
  return (
    <View style={styles.searchRow}>
      <Animated.View pointerEvents={searching ? 'auto' : 'none'} style={[styles.backSlot, search.backStyle]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={cancelLabel}
          onPress={cancelSearch}
          hitSlop={HIT_SLOP_8}
          style={styles.backButton}
          testID={`${testIDPrefix}-cancel`}
        >
          <Icon name="chevron-left" size={28} color={theme.colors.textPrimary} />
        </Pressable>
      </Animated.View>
      <Animated.View
        style={[styles.search, search.fieldStyle, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
      >
        <Icon name="magnify" size={21} color={theme.colors.textMuted} />
        <AppTextInput
          ref={inputRef}
          // The FROZEN text while a cancel glides — see useVaultSearch. The
          // query behind it is already empty; emptying the field on screen too
          // would blank it out from under the rows still showing.
          value={displayQuery}
          onChangeText={onChangeText}
          // The placeholder is drawn by components/AppTextInput as a real
          // <Text>, never by iOS — see that file for why.
          placeholder={placeholder}
          placeholderTextColor={theme.colors.textMuted}
          placeholderTestID={`${testIDPrefix}-placeholder`}
          accessibilityLabel={accessibilityLabel}
          // Incremental: filter as you type, never take the keyboard away.
          // Autocorrect and caps only get in the way of matching names.
          autoCorrect={false}
          autoCapitalize="none"
          spellCheck={false}
          returnKeyType={returnKeyType}
          blurOnSubmit={false}
          onSubmitEditing={onSubmitEditing}
          clearButtonMode="never"
          onFocus={onFocus}
          // NOT onBlur→false: dismissing the keyboard to scroll the results
          // would otherwise throw the header back up and shove the matches down
          // the screen mid-read. Only Cancel leaves search mode.
          style={[styles.searchInput, { color: theme.colors.textPrimary }]}
          testID={`${testIDPrefix}-input`}
        />
        {displayQuery ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={clearLabel}
            onPress={clearSearch}
            style={styles.clearSearch}
          >
            <Icon name="close-circle" size={21} color={theme.colors.textSecondary} />
          </Pressable>
        ) : null}
      </Animated.View>
      {/* The trailing key stays MOUNTED while searching, at zero opacity and
          covered by the field that has slid over it — the row's widths are what
          would otherwise change, and a flex:1 field re-measuring is the one
          thing that stops this being a pure transform. */}
      <Animated.View pointerEvents={searching ? 'none' : 'auto'} style={search.trailingStyle}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={trailingLabel}
          onPress={onTrailingPress}
          hitSlop={HIT_SLOP_8}
          style={styles.addButton}
          testID={`${testIDPrefix}-add`}
        >
          <Icon name={trailingIcon} size={28} color={theme.colors.textPrimary} />
        </Pressable>
      </Animated.View>
    </View>
  );
}

/**
 * One result: a leading square, a name, a meta line — the shape Instagram's
 * user search uses, for the same reason. While searching you are looking for
 * ONE thing by name; a grid of collages spends the whole screen proving what
 * four of them look like. Rows put the names in a column you can run your eye
 * down.
 *
 * `leading` is whatever the page puts in the square (a cover, a collage, a
 * glyph); `trailing` is an optional marker on the right.
 *
 * `leadingStyle` overrides the square — the one thing that legitimately differs
 * between the things being searched. A board's covers and a folder's collage
 * are rectangles and stay square; a PERSON is round, the way faces are round
 * everywhere else in this app.
 */
export function VaultResultRow({ name, meta, leading, leadingStyle, trailing, theme, onPress, onLongPress, onPressIn, accessibilityLabel, accessibilityRole = 'button', accessibilityState, testID }) {
  return (
    <Pressable
      {...TAP_ONLY_PRESSABLE}
      accessibilityRole={accessibilityRole}
      accessibilityState={accessibilityState}
      accessibilityLabel={accessibilityLabel || name}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={onPressIn}
      delayLongPress={500}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.86 : 1 }]}
      testID={testID}
    >
      <View style={[styles.rowCover, { backgroundColor: theme.colors.surfaceElevated }, leadingStyle]}>{leading}</View>
      <View style={styles.rowText}>
        <Text style={[styles.rowName, { color: theme.colors.textPrimary }]} numberOfLines={1}>{name}</Text>
        {meta ? (
          <Text style={[styles.rowMeta, { color: theme.colors.textTertiary ?? theme.colors.textSecondary }]} numberOfLines={1}>{meta}</Text>
        ) : null}
      </View>
      {trailing}
    </Pressable>
  );
}

export const styles = StyleSheet.create({
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: ROW_GAP },
  // Reference: a 38 pt hairline-bordered pill on a transparent fill — not a
  // filled surface. The field reads as an outline, and the fill comes from the
  // page behind it.
  search: { height: SEARCH_HEIGHT, flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: 19, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 8 },
  searchInput: { flex: 1, fontSize: 15, height: '100%', padding: 0 },
  clearSearch: { width: 44, height: 44, marginRight: -12, alignItems: 'center', justifyContent: 'center' },
  // A bare glyph in the reference, not a filled circle. Keeps a 44 pt touch
  // target without drawing a button.
  addButton: { width: ROW_KEY_W, height: 38, alignItems: 'center', justifyContent: 'center' },
  // The back key's slot: absolute in the row's leading gutter, exactly the
  // trailing key's width so the field is symmetric either way round.
  backSlot: { position: 'absolute', left: 0, top: 0, bottom: 0, width: ROW_KEY_W, justifyContent: 'center', zIndex: 2 },
  backButton: { width: ROW_KEY_W, height: 38, alignItems: 'center', justifyContent: 'center' },
  // ── Result row ─────────────────────────────────────────────────────────
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 2 },
  rowCover: { width: ROW_COVER, height: ROW_COVER, borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 15, lineHeight: 19, fontWeight: '600' },
  rowMeta: { fontSize: 13, lineHeight: 17, marginTop: 1 },
});
