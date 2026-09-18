/**
 * ViewerSheet — the bottom-sheet shell the viewer's sheets share.
 *
 * An IN-TREE overlay inside the viewer's Modal, never a second Modal (iOS
 * silently drops a sibling Modal over an open one). The parent mounts it only
 * while open, so a closed sheet costs the gesture path nothing at all. It
 * carries a high zIndex so it draws over every other overlay the viewer or
 * the gallery puts inside the Modal (chrome, share cards).
 *
 * Two detents (the app-wide rule, docs/STYLE-RULES.md §4): the card opens at
 * COLLAPSED (60 % of the screen), a drag up takes it to EXPANDED (92 %), a
 * drag down past collapsed closes it — through utils/useSheetDetents. The
 * scrim tap and the Done button close too. The card is laid out at its
 * expanded height and translated down by the detent difference; the scrim
 * fades as a closing pull leaves the collapsed detent.
 *
 * Keyboard: no KeyboardAvoidingView. The sheet listens to the keyboard, jumps
 * to EXPANDED, lifts by the keyboard's height (a native-driver transform) and
 * caps its height so the header stays on screen; it drops back when the
 * keyboard goes. `topBar` is a fixed row under the header (a composer /
 * search field); `footer` a fixed row at the bottom. `dark` renders the
 * frosted translucent-black variant with white text, for a sheet that should
 * read as part of the viewer, not the app.
 *
 * The footer is PINNED, so the shell — not the caller — owns the space under
 * it: `bottomInset` (or the safe-area inset, whichever is larger) plus 12 pt
 * of air. The body's bottom padding sits inside the ScrollView and never
 * reaches a footer, which is how every sheet with one ended up resting its
 * buttons flush on the home indicator. A footer declares no bottom padding of
 * its own.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSheetDetents } from '../../../../utils/useSheetDetents';
import { depth } from '../../../../utils/surfaceDepth';

const SCREEN_H = Dimensions.get('window').height || 900;
const ENTER_MS = 240;
const EXIT_MS = 200;
export const COLLAPSED_RATIO = 0.6;
/** Expanded = the whole screen: the corners square off and content clears the status bar. */
export const EXPANDED_RATIO = 1;
const CORNER_RADIUS = 24;
/**
 * Air under a pinned footer bar, on top of whatever is below the sheet (the
 * home indicator, or a floating tab bar the caller names through
 * `bottomInset`). §4's "a pinned bar keeps 12 pt of air" — without it the
 * buttons sit flush on the bottom of the screen.
 */
const FOOTER_GAP = 12;

/**
 * The dark variant is a white-on-black surface (docs/STYLE-RULES.md): a
 * blurred, tinted black card, white text, and PILLS that invert — white
 * with black text — so a chip is never "a slightly different dark on dark".
 */
export const DARK_SHEET = {
  // Frosted: a dark tint over the BlurView so the photo shows through,
  // softened, and white text stays legible.
  card: 'rgba(10, 10, 12, 0.55)',
  textPrimary: '#ffffff',
  textSecondary: 'rgba(255,255,255,0.7)',
  textMuted: 'rgba(255,255,255,0.45)',
  border: 'rgba(255,255,255,0.18)',
  handle: 'rgba(255,255,255,0.4)',
  surface: 'rgba(255,255,255,0.12)',
  chip: '#ffffff',
  chipText: '#000000',
  chipGhostBorder: 'rgba(255,255,255,0.45)',
  chipGhostText: '#ffffff',
};

export function sheetColors(theme, dark) {
  const c = theme?.colors || {};
  if (dark) {
    return {
      ...DARK_SHEET,
      primary: '#ffffff',
      background: '#000',
    };
  }
  return {
    card: c.surfaceElevated || c.surface || '#1c1c1e',
    textPrimary: c.textPrimary || '#fff',
    textSecondary: c.textSecondary || 'rgba(255,255,255,0.6)',
    textMuted: c.textMuted || 'rgba(255,255,255,0.4)',
    border: c.border || 'rgba(255,255,255,0.12)',
    handle: c.border || 'rgba(255,255,255,0.25)',
    surface: c.surface || 'rgba(255,255,255,0.08)',
    primary: c.primary || '#3b82f6',
    background: c.background || '#000',
    chip: c.primary || '#3b82f6',
    chipText: c.background || '#000',
    chipGhostBorder: c.border || 'rgba(255,255,255,0.2)',
    chipGhostText: c.textPrimary || '#fff',
  };
}

export default function ViewerSheet({
  onClose,
  /** The Done button's own action, when it is not merely "close" (e.g. an
   *  upload sheet whose Done means "go"). Drag-down and the scrim tap still
   *  call onClose — those are a cancel, never a confirm. */
  onDone,
  title,
  /** A second, quieter line under the title (e.g. "12 photos"). */
  subtitle,
  /** Extra clearance under the content (a floating dock outside this tree). */
  bottomInset = 0,
  doneLabel = 'Done',
  collapsedRatio = COLLAPSED_RATIO,
  expandedRatio = EXPANDED_RATIO,
  keyboard = false,
  dark = false,
  theme,
  topBar,
  footer,
  children,
  testID,
}) {
  const insets = useSafeAreaInsets();
  const expandedH = Math.round(SCREEN_H * expandedRatio);
  const collapsedOffset = Math.max(0, Math.round(SCREEN_H * (expandedRatio - collapsedRatio)));

  const enter = useRef(new Animated.Value(SCREEN_H)).current;
  const scrim = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(0)).current;
  const [kb, setKb] = useState(0);
  // Whether the keyboard actually made the sheet move. RULE: if the keyboard
  // does not cover the field it opened for, nothing on screen changes size or
  // place — the body just gains bottom padding so what sits under the
  // keyboard can still be scrolled to. It only expands + lifts when the top
  // bar (where every input of these sheets lives) would be covered.
  const [lifted, setLifted] = useState(false);
  const topBarRef = useRef(null);
  const [expanded, setExpanded] = useState(false);
  const onDetent = useCallback((d) => setExpanded(d === 'expanded'), []);

  const { offsetY, panHandlers, headerPanHandlers, sheetStyle, scrollProps, expand, toggle, close: closeByDrag } = useSheetDetents({
    collapsedOffset,
    onClose,
    onDetent,
    visible: true,
  });
  // Full screen at the expanded detent: square corners, content below the notch.
  const fullScreen = expanded && expandedRatio >= 1;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(enter, { toValue: 0, duration: ENTER_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(scrim, { toValue: 1, duration: ENTER_MS - 40, useNativeDriver: true }),
    ]).start();
  }, [enter, scrim]);

  // Keyboard: expand, lift above it, cap the height so the header stays put.
  useEffect(() => {
    if (!keyboard) return undefined;
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (e) => {
      const h = e?.endCoordinates?.height || 0;
      const ms = Platform.OS === 'ios' ? (e?.duration || 250) : 180;
      const keyboardTop = SCREEN_H - h;
      const moveUp = () => {
        setKb(h);
        setLifted(true);
        expand();
        Animated.timing(lift, { toValue: -h, duration: ms, easing: Easing.bezier(0.38, 0.7, 0.125, 1), useNativeDriver: true }).start();
      };
      // Not covered: no lift, no height cap — but the card still RISES to its
      // expanded detent so the content under the field (the tag chips) has the
      // room above the keyboard instead of sitting under it.
      const stayPut = () => { setKb(h); setLifted(false); expand(); };
      const node = topBarRef.current;
      if (!node || typeof node.measureInWindow !== 'function') { moveUp(); return; }
      node.measureInWindow((x, y, w, hh) => {
        // Covered = the field's bottom edge (plus a little breathing room)
        // sits below the keyboard's top edge.
        const covered = !(hh > 0) || (y + hh + 12) > keyboardTop;
        if (covered) moveUp(); else stayPut();
      });
    };
    const onHide = (e) => {
      const ms = Platform.OS === 'ios' ? (e?.duration || 250) : 180;
      setKb(0);
      setLifted(false);
      Animated.timing(lift, { toValue: 0, duration: ms, easing: Easing.bezier(0.38, 0.7, 0.125, 1), useNativeDriver: true }).start();
    };
    const s1 = Keyboard.addListener(showEvt, onShow);
    const s2 = Keyboard.addListener(hideEvt, onHide);
    return () => { s1.remove(); s2.remove(); };
  }, [keyboard, expand, lift]);

  const close = useCallback(() => {
    Keyboard.dismiss();
    Animated.timing(scrim, { toValue: 0, duration: EXIT_MS - 20, useNativeDriver: true }).start();
    closeByDrag();
  }, [scrim, closeByDrag]);

  // The scrim fades with the entrance AND as a closing pull leaves the
  // collapsed detent.
  const scrimOpacity = useMemo(() => Animated.multiply(
    scrim,
    offsetY.interpolate({
      inputRange: [collapsedOffset, collapsedOffset + SCREEN_H * 0.4],
      outputRange: [1, 0],
      extrapolate: 'clamp',
    }),
  ), [scrim, offsetY, collapsedOffset]);

  const colors = sheetColors(theme, dark);
  // With the keyboard up the card is expanded and lifted; cap it so its top
  // still clears the status bar.
  const cardHeight = (kb > 0 && lifted) ? Math.min(expandedH, SCREEN_H - kb - insets.top - 8) : expandedH;
  // The footer is a PINNED BAR, not the tail of the scroll: the body's own
  // bottom padding never reaches it, so the shell gives it the clearance.
  // Lifted onto the keyboard there is no home indicator under it any more —
  // only the air.
  const footerPad = (kb > 0 && lifted) ? FOOTER_GAP : Math.max(insets.bottom, bottomInset) + FOOTER_GAP;

  return (
    <View style={[StyleSheet.absoluteFill, styles.root]} testID={testID}>
      <Animated.View style={[StyleSheet.absoluteFill, dark ? styles.scrimDark : styles.scrim, { opacity: scrimOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close" />
      </Animated.View>

      <Animated.View
        style={[
          styles.card,
          { height: cardHeight, backgroundColor: dark ? 'transparent' : colors.card },
          // Light sheets lift off the page; the dark one is frosted glass over
          // a photo and casts nothing (depth() returns {} in dark mode anyway).
          dark ? null : depth(theme, 'overlay'),
          { transform: [{ translateY: Animated.add(enter, lift) }] },
        ]}
        {...panHandlers}
        testID={testID ? `${testID}-card` : undefined}
      >
        {/* The detent / drag translate composes with the entrance + keyboard lift above. */}
        <Animated.View style={[styles.cardInner, { borderTopLeftRadius: fullScreen ? 0 : CORNER_RADIUS, borderTopRightRadius: fullScreen ? 0 : CORNER_RADIUS }, sheetStyle]}>
          {/* Dark variant: frosted black — the photo shows through, blurred,
              under a tint that keeps white text legible. Android gets the
              software blur. */}
          {dark && (
            <BlurView
              intensity={55}
              tint="dark"
              experimentalBlurMethod="dimezisBlurView"
              style={StyleSheet.absoluteFillObject}
              pointerEvents="none"
            />
          )}
          {dark && <View style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.card }]} pointerEvents="none" />}
          <View style={[styles.cardContent, fullScreen && { paddingTop: insets.top }]}>
            {/* The header is a grab bar in its own right: drag it up or down
                from ANY scroll position, or tap it to jump between the two
                detents. The Done button keeps its own press. */}
            <View {...headerPanHandlers} testID={testID ? `${testID}-header` : undefined}>
              <Pressable
                onPress={toggle}
                accessibilityRole="button"
                accessibilityLabel={expanded ? 'Collapse sheet' : 'Expand sheet'}
                style={styles.grab}
                testID={testID ? `${testID}-grab` : undefined}
              >
                <View style={[styles.handle, { backgroundColor: colors.handle }]} />
                <View style={styles.header}>
                  <View style={styles.titles}>
                    <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={1}>{title}</Text>
                    {!!subtitle && <Text style={[styles.subtitle, { color: colors.textSecondary }]} numberOfLines={1}>{subtitle}</Text>}
                  </View>
                  <Pressable onPress={onDone ? () => { Keyboard.dismiss(); onDone(); } : close} hitSlop={12} accessibilityRole="button" accessibilityLabel={doneLabel} style={styles.doneHit} testID={testID ? `${testID}-done` : undefined}>
                    <Text style={[styles.done, { color: colors.primary }]}>{doneLabel}</Text>
                  </Pressable>
                </View>
              </Pressable>
            </View>
            <View ref={topBarRef} collapsable={false}>{topBar}</View>
            <ScrollView
              style={styles.body}
              // Keyboard up but the sheet stayed put → pad the body by the
              // keyboard so the tail of the list is still reachable.
              contentContainerStyle={[styles.bodyContent, { paddingBottom: 24 + Math.max(insets.bottom, bottomInset) + (kb > 0 && !lifted ? kb : 0) }]}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator
              scrollIndicatorInsets={{ right: 1 }}
              indicatorStyle={dark ? 'white' : 'default'}
              {...scrollProps}
            >
              {children}
            </ScrollView>
            {!!footer && (
              <View style={{ paddingBottom: footerPad }} testID={testID ? `${testID}-footer` : undefined}>
                {footer}
              </View>
            )}
          </View>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    zIndex: 1000,
    elevation: 1000,
  },
  scrim: {
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  scrimDark: {
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  card: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  cardInner: {
    flex: 1,
    overflow: 'hidden',
  },
  cardContent: {
    flex: 1,
    paddingHorizontal: 20,
  },
  grab: {
    // The whole block is the tap/drag target — comfortably over 44pt.
    paddingBottom: 2,
  },
  handle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    minHeight: 44,
  },
  titles: {
    flex: 1,
    flexShrink: 1,
    paddingRight: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    flexShrink: 1,
  },
  subtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  doneHit: {
    minHeight: 44,
    justifyContent: 'center',
  },
  done: {
    fontSize: 16,
    fontWeight: '600',
  },
  body: {
    flex: 1,
    flexShrink: 1,
  },
  bodyContent: {
    paddingBottom: 24,
  },
});
