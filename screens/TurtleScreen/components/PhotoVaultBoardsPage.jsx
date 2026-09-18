import React, { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AppTextInput from '../../../components/AppTextInput';
import { Image } from 'expo-image';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import PhotoVaultBoardCard from './PhotoVaultBoardCard';
import { TAP_ONLY_PRESSABLE } from '../../../utils/pressBehavior';

const SORTS = [
  { mode: 'recent', label: 'Recent', icon: 'clock-outline' },
  { mode: 'alphabetical', label: 'A–Z', icon: 'sort-alphabetical-ascending' },
  { mode: 'largest', label: 'Largest', icon: 'image-multiple-outline' },
];

// Grid proportions taken from the Pinterest boards reference (1170px wide @3x,
// i.e. a 390pt screen): cards sit 20px (≈7pt) from the screen edges with the
// same 20px between columns, which lands each card at ~185pt.
const EDGE_PAD = 7;
const COLUMN_GAP = 7;
// The search pill's height, shared by the field and by the placeholder's
// lineHeight (which is how the placeholder centres itself over the input).
const SEARCH_HEIGHT = 38;
// Breathing room between the tab picker in the fixed header above and the
// search field. `topInset` only clears the header's height, so without this the
// search field sits flush against the tab underline.
const PICKER_GAP = 14;
// Long-press does nothing on All Photos: it is not renameable or deletable.
const NOOP = () => {};
// Restores the 44pt accessible target for controls whose VISIBLE height is
// smaller (bare add glyph, 34pt sort chips) — the reference's proportions
// without giving up hit area.
const HIT_SLOP_8 = { top: 8, bottom: 8, left: 8, right: 8 };
// The trailing key's width and the row's gap. Searching hands that space to the
// field on the right and takes the same amount back on the left for the back
// key, so the field's width never changes — it only moves. Keep these two in
// step with `addButton.width` and `searchRow.gap`.
const ROW_KEY_W = 44;
const ROW_GAP = 10;
const SEARCH_SHIFT = ROW_KEY_W + ROW_GAP;
const CARD_WIDTH = (Dimensions.get('window').width - EDGE_PAD * 2 - COLUMN_GAP) / 2;
const LOAD_ERROR_COPY = 'Unable to load boards';
const REFRESH_ERROR_COPY = 'Couldn’t refresh boards.';
// The search result row's cover square. A row is ~62pt tall, so ~14 boards fit
// a screen against the grid's 4 — which is the whole point of the mode.
const ROW_COVER = 46;

// ── The search transition's timings ─────────────────────────────────────────
// Exported because TWO things move on them: this page lifts, and the vault
// header above it slides away (MediaGallery). They are one movement seen in
// two components, so they cannot each own a copy of the numbers — the moment
// those disagree you get the header and the field arriving separately.
//
// Both curves DECELERATE into rest (ease-out, not ease-in): the element is
// settling into a position, and a curve that accelerates into the end is what
// makes a close feel like a snap rather than a close. Out is shorter than in —
// leaving a search is a dismissal, and a slow one feels like the app arguing.
export const SEARCH_ENTER = { duration: 280, easing: Easing.out(Easing.cubic) };
export const SEARCH_EXIT = { duration: 240, easing: Easing.out(Easing.cubic) };

/**
 * One search result: cover square, name, count — the shape Instagram's user
 * search uses, for the same reason. While searching you are looking for ONE
 * board by name; a two-up grid of collages spends the whole screen proving
 * what four of them look like. Rows put the names in a column you can run your
 * eye down.
 */
const BoardRow = React.memo(function BoardRow({ board, theme, resolveCoverUrl, onPress, onLongPress, onPressIn }) {
  const cover = board.covers?.[0];
  return (
    <Pressable
      {...TAP_ONLY_PRESSABLE}
      accessibilityRole="button"
      accessibilityLabel={`${board.name}, ${board.count} item${board.count === 1 ? '' : 's'}${board.isLive ? ', shared on the web' : ''}`}
      onPress={() => onPress(board.name)}
      onLongPress={() => onLongPress(board.name)}
      onPressIn={onPressIn}
      delayLongPress={500}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.86 : 1 }]}
    >
      <View style={[styles.rowCover, { backgroundColor: theme.colors.surfaceElevated }]}>
        {cover ? (
          <Image
            source={{ uri: resolveCoverUrl(cover) }}
            style={StyleSheet.absoluteFillObject}
            contentFit="cover"
            transition={120}
            recyclingKey={`row:${cover}`}
          />
        ) : (
          <Icon name="image-multiple-outline" size={20} color={theme.colors.textMuted} />
        )}
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowName, { color: theme.colors.textPrimary }]} numberOfLines={1}>{board.name}</Text>
        <Text style={[styles.rowMeta, { color: theme.colors.textTertiary ?? theme.colors.textSecondary }]} numberOfLines={1}>
          {board.itemLabel ?? board.metadata}
          {board.recency ? `  ${board.recency}` : ''}
        </Text>
      </View>
      {board.isLive ? (
        <View style={[styles.rowSharedDot, { backgroundColor: theme.colors.accentInfo || theme.colors.primary }]} />
      ) : null}
    </Pressable>
  );
});

function BoardSkeleton({ index, theme }) {
  return (
    <View testID={`board-skeleton-${index}`} style={[styles.skeleton, { width: CARD_WIDTH }]}>
      <View style={[styles.skeletonCollage, { backgroundColor: theme.colors.surfaceElevated }]} />
      <View style={[styles.skeletonLine, { backgroundColor: theme.colors.surfaceHighlight }]} />
      <View style={[styles.skeletonMeta, { backgroundColor: theme.colors.surface }]} />
    </View>
  );
}

const PhotoVaultBoardsPage = forwardRef(({
  boards,
  allPhotos,
  onOpenAllPhotos,
  loading,
  error,
  hasLoadedAlbums = false,
  query,
  sortMode,
  theme,
  topInset,
  resolveCoverUrl,
  onQueryChange,
  onSortModeChange,
  onAdd,
  onRetry,
  onOpenBoard,
  onLongPressBoard,
  onCardPressIn,
  onOpenShareInsights,
  onScroll,
  onContentSizeChange,
  onLayout,
  // Fires when the page enters / leaves search mode, so the vault's title +
  // Boards/Music tabs can stand down and let the field rise to the top.
  onSearchActiveChange,
  // The top inset the page keeps while SEARCHING — the bare safe area, once
  // the vault header has slid away. The difference between this and `topInset`
  // is how far the page lifts.
  searchTopInset,
  // POINTS the chrome is currently pushed off the top, tracking the scroll
  // one-for-one (utils/scrollChrome). Pixels rather than a 0→1 progress so the
  // dock and the header above it move at the SAME rate as each other and as
  // the finger, instead of each covering its own distance in the same time.
  chromePx,
  // Reports the measured dock height up, so the parent can cap the travel
  // budget at the larger of the two things that hide.
  onDockHeight,
}, ref) => {
  const visibleBoards = hasLoadedAlbums ? boards : [];
  const onPrimary = theme.colors.onPrimary ?? theme.colors.background;
  const searchRef = useRef(null);
  // Measured so the list can reserve exactly the dock's height and the dock can
  // travel exactly its own height when it hides — no guesses, no gap.
  const [dockH, setDockH] = useState(0);

  // Search mode: the field is focused, or something is typed in it. Focus is
  // half of it on purpose — tapping the field is the moment you want the room,
  // not the first keystroke — and the query is the other half so the mode
  // survives the keyboard being dismissed with results on screen.
  const [focused, setFocused] = useState(false);
  // While a cancel is gliding home, this holds the search the user is still
  // LOOKING at — the matched rows and the text in the field — even though the
  // query itself has already been cleared. See cancelSearch for why.
  const [exitSnapshot, setExitSnapshot] = useState(null);
  const exiting = exitSnapshot !== null;
  const searching = focused || !!query || exiting;
  // What the page RENDERS, as opposed to what the parent currently holds. The
  // two are the same except during that exit glide.
  const displayQuery = exiting ? exitSnapshot.query : query;
  const displayBoards = exiting ? exitSnapshot.boards : visibleBoards;

  // ── The lift ────────────────────────────────────────────────────────────
  // How far the page rises when search takes over: exactly the height of the
  // vault header it is being allowed to use (topInset covers that header;
  // searchTopInset is the bare safe area left once it has gone).
  //
  // It is a TRANSFORM, not a change of padding, and the wrapper carries a
  // permanent `marginBottom: -lift` so it is already that much taller than the
  // screen. So nothing in here ever relayouts — a padding animation would run
  // a full layout pass over a list of boards on every frame of the transition,
  // which is precisely the jank this is meant to remove. The list's content
  // gets the same `lift` back as bottom padding, so while browsing (translate
  // 0) the last board can still be scrolled clear of the screen edge.
  const lift = Math.max(0, topInset - (searchTopInset ?? topInset));
  const liftAnim = useRef(new Animated.Value(0)).current;
  // Invalidates a cancel that is still gliding. Tap the field again before it
  // lands and the pending "put the grid back" must not fire into the search you
  // have just reopened.
  const cancelRunRef = useRef(0);
  // Where liftAnim has already been SENT. cancelSearch drives the exit itself,
  // so without this the effect below fired a second, identical 0→0 timing the
  // moment `searching` caught up — a redundant native animation started on the
  // exact frame the page was landing.
  const liftTargetRef = useRef(0);

  // Entering. Leaving does NOT go through here — cancelSearch drives its own
  // animation so it can clear the query on the way OUT (see there). This still
  // catches an exit the caller made some other way, e.g. the query being
  // cleared from outside while the field is not focused.
  useEffect(() => {
    onSearchActiveChange?.(searching);
    const target = searching ? 1 : 0;
    // Already going there (or already there): cancelSearch drove the exit, and
    // the mount starts at rest. Re-sending the same target buys nothing and
    // costs a native animation start.
    if (liftTargetRef.current === target) return;
    liftTargetRef.current = target;
    Animated.timing(liftAnim, {
      toValue: target,
      ...(searching ? SEARCH_ENTER : SEARCH_EXIT),
      useNativeDriver: true,
    }).start();
  }, [searching, liftAnim, onSearchActiveChange]);
  const liftStyle = {
    transform: [{ translateY: liftAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -lift] }) }],
  };

  // ── The field sliding off the back key ──────────────────────────────────
  // All three of these ride `liftAnim`, so the row moves as one piece with the
  // page it sits on, on the same curve, driven natively.
  //
  // The field keeps its browsing WIDTH throughout and simply translates right
  // by the slot it is given back on the other side — the add key's 44 plus the
  // row's 10 gap. That is why the add key stays mounted: the moment the trailing
  // child unmounts, a flex:1 field grows into the space and the whole row
  // relayouts mid-animation, which no transform can smooth over.
  const searchShiftStyle = {
    transform: [{
      translateX: liftAnim.interpolate({ inputRange: [0, 1], outputRange: [0, SEARCH_SHIFT] }),
    }],
  };
  // The key leads the field in slightly rather than appearing at its final
  // place — it reads as arriving with the field rather than blinking on.
  const backStyle = {
    opacity: liftAnim,
    transform: [{
      translateX: liftAnim.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }),
    }],
  };
  const addStyle = { opacity: liftAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) };

  /**
   * Cancel: keyboard down, page down, header back — then the results go.
   *
   * WHAT IS ON SCREEN and WHAT THE PARENT HOLDS part company here, on purpose,
   * and it is the whole reason this reads smoothly.
   *
   * Clearing the query is EXPENSIVE, and none of the cost is ours: the parent
   * re-renders, rebuilds every board model from the filtered set back to the
   * full one, rebuilds the A–Z scrub index off that, and mounts the rail. Doing
   * it in the animation's completion callback — which is what this used to do —
   * piled all of that onto the single frame the page was landing on, and that
   * long frame is the stutter you felt at the end of every close.
   *
   * So the query is cleared on the FIRST frame instead, and `exitSnapshot`
   * holds the rows and the field text the user is still looking at so the
   * screen does not change while the page glides. The work now happens DURING
   * the glide, where it is free: both halves of this movement are
   * `useNativeDriver`, so they run on the UI thread and a busy JS thread cannot
   * touch them. When the page lands there is nothing left to do but drop the
   * snapshot.
   *
   * (Clearing it early WITHOUT the snapshot is the other thing this used to do,
   * and it is why the callback looked like the fix: the rows swapped back to
   * the grid on frame one and you watched a page slide down already showing
   * something else. Frozen, it looks exactly like the version that stuttered.)
   *
   * The keyboard goes first and on its own: iOS dismisses over about the same
   * quarter-second, so starting it on this frame means it lands with the page
   * instead of lingering under a page that has already parked.
   */
  const cancelSearch = useCallback(() => {
    Keyboard.dismiss();
    searchRef.current?.blur();
    setFocused(false);
    // The header starts coming back NOW, with the page — it is the other half
    // of the same movement, and it must not wait for anything else.
    onSearchActiveChange?.(false);
    setExitSnapshot({ boards: visibleBoards, query });
    onQueryChange('');
    liftTargetRef.current = 0;
    const run = ++cancelRunRef.current;
    Animated.timing(liftAnim, { toValue: 0, ...SEARCH_EXIT, useNativeDriver: true })
      .start(({ finished }) => {
        if (finished && cancelRunRef.current === run) setExitSnapshot(null);
      });
  }, [onQueryChange, onSearchActiveChange, liftAnim, visibleBoards, query]);

  // Clearing is part of typing, not the end of it — keep the field focused so the
  // keyboard stays up and the user can retype immediately (standard search UX).
  const clearSearch = useCallback(() => {
    onQueryChange('');
    searchRef.current?.focus();
  }, [onQueryChange]);

  /**
   * Opening a result ends the typing, so the keyboard goes — the board you were
   * hunting for is about to fill the screen and nothing is left to type into.
   * `keyboardShouldPersistTaps="handled"` means the tap lands on the row with
   * the keyboard still up, so it has to be dismissed here rather than by the
   * usual tap-outside.
   *
   * Only the KEYBOARD, though — deliberately not `cancelSearch`. Search mode
   * survives (same reason the field has no onBlur exit): come back from the
   * board and your query and its results are still there to pick the next one
   * from, instead of a page that threw the search away behind your back.
   */
  const openBoard = useCallback((name) => {
    Keyboard.dismiss();
    onOpenBoard(name);
  }, [onOpenBoard]);

  const openAllPhotos = useCallback((name) => {
    Keyboard.dismiss();
    onOpenAllPhotos(name);
  }, [onOpenAllPhotos]);

  // The search dock is OUTSIDE the list, always. It used to ride in the list's
  // header, which made the field a child of whichever list was mounted — and
  // switching between the two-up grid and the results rows remounts the list
  // (numColumns can only change across a remount). That would have torn the
  // focused TextInput out mid-keystroke and dropped the keyboard.
  const renderSearchDock = () => (
    <View style={[styles.searchDock, { paddingTop: topInset + PICKER_GAP, backgroundColor: theme.colors.background }]}>
      <View style={styles.searchRow}>
        {/* Back — the way out of search, in the place a back key belongs.
            Absolutely positioned in the slot the field slides off, so it costs
            the row no layout: everything here moves by transform, and the row
            itself never re-measures (same rule as the page lift above).
            pointerEvents is tied to `searching` because while browsing this
            sits invisible OVER the field's magnifier and would otherwise eat
            the tap that opens search. */}
        <Animated.View
          pointerEvents={searching ? 'auto' : 'none'}
          style={[styles.backSlot, backStyle]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel board search"
            onPress={cancelSearch}
            hitSlop={HIT_SLOP_8}
            style={styles.backButton}
            testID="board-search-cancel"
          >
            <Icon name="chevron-left" size={28} color={theme.colors.textPrimary} />
          </Pressable>
        </Animated.View>
        <Animated.View
          style={[styles.search, searchShiftStyle, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
        >
          <Icon name="magnify" size={21} color={theme.colors.textMuted} />
          <AppTextInput
            ref={searchRef}
            // The FROZEN text while a cancel glides — see cancelSearch. The
            // query behind it is already empty; emptying the field on screen
            // too would blank it out from under the rows still showing.
            value={displayQuery}
            onChangeText={onQueryChange}
            // The placeholder is drawn by components/AppTextInput as a real
            // <Text>, never by iOS — see that file for why. This screen is
            // where the artefact was found.
            placeholder="Search your boards"
            placeholderTextColor={theme.colors.textMuted}
            placeholderTestID="board-search-placeholder"
            accessibilityLabel="Search your boards"
            // Incremental search: filter as you type, never take the keyboard
            // away. Submitting is a no-op (blurOnSubmit=false) because results
            // are already live, and autocorrect/caps only get in the way of
            // matching board names.
            autoCorrect={false}
            autoCapitalize="none"
            spellCheck={false}
            returnKeyType="search"
            blurOnSubmit={false}
            clearButtonMode="never"
            // Re-focusing mid-glide takes the exit back: bump the run so the
            // landing callback is a no-op, and drop the frozen copy so the
            // field and the rows follow the live query again.
            onFocus={() => { cancelRunRef.current += 1; setExitSnapshot(null); setFocused(true); }}
            // NOT onBlur→false: dismissing the keyboard to scroll the results
            // would otherwise throw the header back up and shove the matches
            // down the screen mid-read. Only Cancel leaves search mode.
            style={[styles.searchInput, { color: theme.colors.textPrimary }]}
          />
          {displayQuery ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear board search"
              onPress={clearSearch}
              style={styles.clearSearch}
            >
              <Icon name="close-circle" size={21} color={theme.colors.textSecondary} />
            </Pressable>
          ) : null}
        </Animated.View>
        {/* Add photos. It stays MOUNTED while searching, at zero opacity and
            covered by the field that has slid over it — the row's widths are
            what would otherwise change, and a flex:1 field re-measuring is the
            one thing that stops this being a pure transform. */}
        <Animated.View pointerEvents={searching ? 'none' : 'auto'} style={addStyle}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add photos to a board"
            onPress={onAdd}
            hitSlop={HIT_SLOP_8}
            style={styles.addButton}
          >
            <Icon name="plus" size={28} color={theme.colors.textPrimary} />
          </Pressable>
        </Animated.View>
      </View>

      {/* Sort chips — in the DOCK, not in the list header, so they stay put
          while the boards scroll under them. They used to ride in
          ListHeaderComponent and left the screen with the first flick, which
          meant re-sorting a long library was: scroll all the way back up,
          then choose. The field above them was already fixed; these are the
          other half of the same control surface and belong beside it.

          Still gone while SEARCHING — results are relevance-ordered, so a
          sort choice would not describe them. */}
      {!searching ? (
      <ScrollView
          testID="board-sort-scroll"
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.sorts}
          style={styles.sortScroller}
        >
          {SORTS.map(({ mode, label, icon }) => {
            const selected = sortMode === mode;
            return (
              <Pressable
                key={mode}
                accessibilityRole="button"
                accessibilityLabel={`Sort boards by ${mode}`}
                accessibilityState={{ selected }}
                onPress={() => onSortModeChange(mode)}
                hitSlop={HIT_SLOP_8}
                style={[
                  styles.sort,
                  // Filled, borderless pills as in the reference — the unselected
                  // fill does the work the border used to.
                  { backgroundColor: selected ? theme.colors.primary : theme.colors.surfaceElevated },
                ]}
              >
                <Icon
                  testID={selected ? `sort-selected-${mode}` : undefined}
                  name={selected ? 'check' : icon}
                  size={16}
                  color={selected ? onPrimary : theme.colors.textSecondary}
                />
                <Text style={[styles.sortLabel, { color: selected ? onPrimary : theme.colors.textSecondary }]}>{label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {/* A refresh that failed is reported under the field in BOTH modes. It
          used to live with the sort chips, which search takes away — and
          "nothing matched" reads very differently when the list you searched
          is a stale one. */}
      {error && hasLoadedAlbums && (
        <View style={[styles.retryBanner, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
          <Text style={[styles.retryBannerText, { color: theme.colors.textSecondary }]}>{REFRESH_ERROR_COPY}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry loading boards"
            onPress={onRetry}
            style={styles.retryBannerAction}
          >
            <Text style={[styles.retryBannerActionText, { color: theme.colors.primary }]}>Retry</Text>
          </Pressable>
        </View>
      )}
    </View>
  );

  // Everything the grid shows ABOVE the boards: the sort chips and the pinned
  // All Photos card. None of it survives into search mode — the results start
  // directly under the field, which is the whole ask.
  const renderGridHeader = () => (
    <View style={styles.gridHeader}>

      {/* All Photos — the whole library as a board, pinned above the user's own.
          Deliberately outside the grid data: it is never reordered by the sort
          chips, because it is a fixed entry point rather than content. Full
          width so it reads as the parent of the two-column boards below.

          It does go away WHILE SEARCHING, though. Pinned, it sat above the
          results claiming to be one — a card that matches every query because
          it was never filtered at all. During a search the only thing on the
          page should be what matched. */}
      {allPhotos && !displayQuery ? (
        <View style={styles.allPhotosSlot}>
          <PhotoVaultBoardCard
            board={allPhotos}
            width={CARD_WIDTH * 2 + COLUMN_GAP}
            theme={theme}
            resolveCoverUrl={resolveCoverUrl}
            onPress={openAllPhotos}
            onLongPress={NOOP}
          />
        </View>
      ) : null}
    </View>
  );

  const renderEmpty = () => {
    if (!hasLoadedAlbums && !error) {
      return <View style={styles.skeletonGrid}>{[0, 1, 2, 3].map((index) => <BoardSkeleton key={index} index={index} theme={theme} />)}</View>;
    }

    if (!hasLoadedAlbums) {
      return (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>{LOAD_ERROR_COPY}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry loading boards"
            onPress={onRetry}
            style={[styles.emptyAction, { backgroundColor: theme.colors.surfaceElevated }]}
          >
            <Text style={[styles.emptyActionText, { color: theme.colors.textPrimary }]}>Retry</Text>
          </Pressable>
        </View>
      );
    }

    return (
      <View style={styles.empty}>
        <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
          {displayQuery ? `No boards match “${displayQuery}”.` : 'Create your first board by adding photos.'}
        </Text>
        {!displayQuery && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add photos to create a board"
            onPress={onAdd}
            style={[styles.emptyAction, { backgroundColor: theme.colors.surfaceElevated }]}
          >
            <Text style={[styles.emptyActionText, { color: theme.colors.textPrimary }]}>Add photos</Text>
          </Pressable>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.page, { backgroundColor: theme.colors.background }]}>
      <Animated.View style={[styles.lift, { marginBottom: -lift }, liftStyle]}>
      {/* The dock is ABSOLUTE over the list now, not stacked above it in flow.
          That is what lets it leave: in flow, sliding it up would drag the list
          with it and there would be nothing underneath. Over the list, it
          travels its own height and the boards are already there behind it —
          which is the whole Pinterest read. The list reserves the same height
          as top padding, so at rest nothing has moved. */}
      <Animated.View
        style={[
          styles.dockWrap,
          chromePx && dockH > 0 ? {
            transform: [{
              translateY: chromePx.interpolate({
                inputRange: [0, dockH],
                outputRange: [0, -dockH],
                extrapolate: 'clamp',
              }),
            }],
          } : null,
        ]}
        onLayout={(e) => {
          const h = Math.round(e.nativeEvent.layout.height);
          // Thresholded: onLayout fires on every sub-pixel wobble, and a state
          // write per frame would re-render the whole page mid-scroll.
          if (h > 0) {
            setDockH((prev) => (Math.abs(prev - h) >= 1 ? h : prev));
            onDockHeight?.(h);
          }
        }}
      >
        {renderSearchDock()}
      </Animated.View>
      <Animated.FlatList
        // The key is what swaps the layout: numColumns cannot change on a
        // mounted list (RN says so outright), so grid ⇄ rows is a remount. The
        // search field is deliberately not inside this subtree, so the remount
        // costs nothing but the scroll offset.
        key={searching ? 'boards-rows' : 'boards-grid'}
        ref={ref}
        // displayBoards, not visibleBoards: through a cancel the parent has
        // already gone back to the full set, and these rows must keep showing
        // the matches until the page has landed.
        data={displayBoards}
        keyExtractor={(board) => board.name}
        numColumns={searching ? 1 : 2}
        renderItem={({ item }) => (searching ? (
          <BoardRow
            board={item}
            theme={theme}
            resolveCoverUrl={resolveCoverUrl}
            onPress={openBoard}
            onLongPress={onLongPressBoard}
            onPressIn={onCardPressIn}
          />
        ) : (
          <PhotoVaultBoardCard
            board={item}
            width={CARD_WIDTH}
            theme={theme}
            resolveCoverUrl={resolveCoverUrl}
            onPress={openBoard}
            onLongPress={onLongPressBoard}
            onPressIn={onCardPressIn}
            onPressShared={onOpenShareInsights}
          />
        ))}
        // Elements, NOT functions. VirtualizedList renders a function-valued
        // ListHeaderComponent as `<ListHeaderComponent />`; a header function
        // defined in this render body is a new identity — and therefore a new
        // element type — on every render, so React tore down and rebuilt the
        // header on each keystroke. (The field has since moved out of the list
        // entirely, but the sort chips would still churn.)
        ListHeaderComponent={searching ? null : renderGridHeader()}
        ListEmptyComponent={renderEmpty()}
        contentContainerStyle={[styles.content, { backgroundColor: theme.colors.background, paddingTop: dockH, paddingBottom: 24 + lift }]}
        columnWrapperStyle={!searching && displayBoards.length ? styles.gridRow : undefined}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScroll={onScroll}
        // The chrome rides an Animated.event on this prop. Left at the default
        // iOS coalesces scroll events down to a trickle, and one-for-one
        // tracking of a signal that only arrives now and then is a header that
        // steps rather than follows.
        scrollEventThrottle={16}
        onContentSizeChange={onContentSizeChange}
        onLayout={onLayout}
      />
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  page: { flex: 1 },
  // Over the list, not above it. zIndex keeps it on top of the boards it is
  // sliding away from; the list's own paddingTop holds the space it occupies
  // at rest, so nothing jumps when it is shown.
  dockWrap: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 6 },
  // The lifting layer. Its negative bottom margin is static: it is always
  // `lift` taller than the page, so the rise is a transform with nothing
  // underneath it to re-lay out.
  lift: { flex: 1 },
  content: { paddingHorizontal: EDGE_PAD },
  // The dock the field lives in, above the list rather than inside it.
  searchDock: { paddingHorizontal: EDGE_PAD, paddingBottom: 10 },
  gridHeader: { marginHorizontal: -EDGE_PAD, paddingHorizontal: EDGE_PAD, paddingBottom: 16 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: ROW_GAP },
  // Reference: a 114px (38pt) hairline-bordered pill on a transparent fill —
  // not a filled surface. The search field reads as an outline, and the fill
  // comes from the page behind it.
  search: { height: SEARCH_HEIGHT, flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: 19, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 8 },
  searchInput: { flex: 1, fontSize: 15, height: '100%', padding: 0 },
  clearSearch: { width: 44, height: 44, marginRight: -12, alignItems: 'center', justifyContent: 'center' },
  // A bare glyph in the reference, not a filled circle. Keeps a 44pt touch
  // target without drawing a button.
  addButton: { width: ROW_KEY_W, height: 38, alignItems: 'center', justifyContent: 'center' },
  // The back key's slot: absolute in the row's leading gutter, exactly the
  // trailing key's width so the field is symmetric either way round. Out of the
  // flow, so appearing costs the row no layout pass.
  backSlot: { position: 'absolute', left: 0, top: 0, bottom: 0, width: ROW_KEY_W, justifyContent: 'center', zIndex: 2 },
  backButton: { width: ROW_KEY_W, height: 38, alignItems: 'center', justifyContent: 'center' },
  // ── Search result row (Instagram-style) ────────────────────────────────
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 2 },
  rowCover: { width: ROW_COVER, height: ROW_COVER, borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 15, lineHeight: 19, fontWeight: '600' },
  rowMeta: { fontSize: 13, lineHeight: 17, marginTop: 1 },
  rowSharedDot: { width: 7, height: 7, borderRadius: 3.5 },
  sortScroller: { marginTop: 14 },
  allPhotosSlot: { marginTop: 16 },
  sorts: { flexDirection: 'row', gap: 8, paddingRight: EDGE_PAD },
  // Filled grey pills, no border, ~32pt tall as in the reference. The 44pt
  // accessible target comes from hitSlop rather than the visible height.
  sort: { height: 34, borderRadius: 17, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6 },
  sortLabel: { fontSize: 15, fontWeight: '600' },
  retryBanner: { marginTop: 12, minHeight: 44, borderWidth: 1, borderRadius: 12, paddingLeft: 12, paddingRight: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  retryBannerText: { fontSize: 14, fontWeight: '600' },
  retryBannerAction: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  retryBannerActionText: { fontSize: 14, fontWeight: '700' },
  gridRow: { gap: COLUMN_GAP },
  skeletonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: COLUMN_GAP },
  skeleton: { marginBottom: 26 },
  skeletonCollage: { aspectRatio: 1.46, borderRadius: 12 },
  skeletonLine: { width: '68%', height: 16, borderRadius: 8, marginTop: 8, marginHorizontal: 2 },
  skeletonMeta: { width: '45%', height: 13, borderRadius: 7, marginTop: 5, marginHorizontal: 2 },
  empty: { alignItems: 'center', paddingTop: 48, paddingHorizontal: 24 },
  emptyText: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
  emptyAction: { marginTop: 16, borderRadius: 22, paddingHorizontal: 18, minHeight: 44, justifyContent: 'center' },
  emptyActionText: { fontSize: 15, fontWeight: '700' },
});

export default PhotoVaultBoardsPage;
