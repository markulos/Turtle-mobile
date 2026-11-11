/**
 * SearchScopeToggle — "My library | Web", above the results.
 *
 * A RULE that glides under the live key, which is the Planner header's tab bar
 * (TasksScreen/index.jsx, `tabUnderline`) rather than a segmented control. It
 * used to be a lit pill the keys sat inside; asked for as an underline on
 * 2026-11-11 so the two tab rows in the app read as the same control.
 *
 * Three things were copied deliberately from that bar, because each is the
 * answer to something that looks fine until it is on a device:
 *
 *   - The keys are sized to their CONTENT, not two equal halves. A rule under
 *     half a screen is a banner, not an underline; under the word it belongs
 *     to it reads as one.
 *   - Both labels are the SAME ink. The active one is heavier and the inactive
 *     one is dimmed by opacity — stacking a dimmer COLOUR under an opacity
 *     compounds to roughly 40%, where a label stops being legible.
 *   - The rule is the accent, not the ink: it is the one mark saying which
 *     scope you are on, and the accent is what means "active" everywhere else.
 *
 * Unlike the Planner's bar this animates `width` directly instead of scaling a
 * 1pt sliver. That bar is on RN's native driver, which does transforms and
 * opacity only; this one is Reanimated, where a width runs on the UI thread
 * just as happily and spares the reader a transformOrigin puzzle.
 *
 * ── Why it sits in the LIST's header and not in the search dock ──────────
 * The dock is absolutely positioned and the lists reserve its measured height
 * as top padding, so anything added to it changes that height — and a height
 * that changes when search opens is a relayout of the whole list during the
 * one animation MusicVault is built to keep free of them. In the header it
 * costs nothing, and it is where the eye already is: directly above the rows
 * whose source it decides.
 */
import React, { memo, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Reanimated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { tapHaptic } from '../../../utils/haptics';

const SLIDE_MS = 260;
const SLIDE_EASE = Easing.bezier(0.4, 0, 0.2, 1);

function SearchScopeToggle({ value, options, onChange, theme, testID = 'search-scope' }) {
  const c = theme.colors;
  // Each key reports its frame once laid out; the rule is driven from those,
  // so the two keys can be different widths without measuring any text.
  const [frames, setFrames] = useState({});
  const barX = useSharedValue(0);
  const barW = useSharedValue(0);
  const settledRef = useRef(false);
  const frame = frames[value];

  useEffect(() => {
    if (!frame) return;
    if (!settledRef.current) {
      // First layout: place the rule without motion, or it flies in from the
      // left edge every time search is opened.
      barX.value = frame.x;
      barW.value = frame.width;
      settledRef.current = true;
      return;
    }
    barX.value = withTiming(frame.x, { duration: SLIDE_MS, easing: SLIDE_EASE });
    barW.value = withTiming(frame.width, { duration: SLIDE_MS, easing: SLIDE_EASE });
  }, [frame, barX, barW]);

  const barStyle = useAnimatedStyle(() => ({
    width: barW.value,
    transform: [{ translateX: barX.value }],
    opacity: barW.value > 0 ? 1 : 0,
  }));

  return (
    <View style={styles.box} accessibilityRole="tablist" testID={testID}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onLayout={(e) => {
              const { x, width } = e.nativeEvent.layout;
              setFrames((prev) => (
                prev[o.value] && prev[o.value].x === x && prev[o.value].width === width
                  ? prev
                  : { ...prev, [o.value]: { x, width } }
              ));
            }}
            // Haptic on press-IN, like every other key in the app: the tap is
            // already committed by then, and a finger that is still moving
            // never gets one (utils/haptics).
            onPressIn={() => tapHaptic()}
            onPress={() => { if (!on) onChange(o.value); }}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.accessibilityLabel || o.label}
            testID={`${testID}-${o.value}`}
            hitSlop={{ top: 8, bottom: 8 }}
            style={({ pressed }) => [
              styles.key,
              i === options.length - 1 && styles.keyLast,
              pressed && !on && styles.pressed,
            ]}
          >
            <Text
              style={[
                styles.keyText,
                { color: c.textPrimary },
                on ? styles.keyTextActive : styles.keyTextInactive,
              ]}
              numberOfLines={1}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
      {/* Last, so it paints over the keys' baseline rather than under them.
          pointerEvents none: it sits across both keys and would otherwise
          swallow the tap for whichever one it happens to be covering. */}
      <Reanimated.View
        pointerEvents="none"
        style={[styles.bar, { backgroundColor: c.accent || c.accentInfo }, barStyle]}
      />
    </View>
  );
}

export default memo(SearchScopeToggle);

const styles = StyleSheet.create({
  // A row of words with a rule under the live one. No box and no border: the
  // rule is the whole indicator, and a frame around it would put this control
  // back in the segmented-control family it was moved out of.
  box: { flexDirection: 'row', alignItems: 'flex-end', height: 28 },
  bar: {
    position: 'absolute',
    bottom: 0,
    // left:0, NOT a padding: a key's measured `x` already includes the row's
    // own box, so adding anything here parks the rule to the right of the word
    // it belongs under.
    left: 0,
    // Square ends and 2.5pt, matching the Planner's bar exactly. A rounded cap
    // at this height reads as a pill fragment, which is the look being left
    // behind.
    height: 2.5,
  },
  // Content-width, with the gap AFTER it. The gap is the only thing separating
  // the two keys, so it does all the work of telling them apart.
  key: { marginRight: 22, paddingBottom: 6, justifyContent: 'flex-end' },
  keyLast: { marginRight: 0 },
  // The music screen's own type, kept: this change was asked for as "just have
  // a line under", so the rule moved and the lettering did not.
  keyText: { fontSize: 10.5, letterSpacing: 0.9, textTransform: 'uppercase' },
  keyTextActive: { fontWeight: '700' },
  keyTextInactive: { fontWeight: '500', opacity: 0.6 },
  pressed: { opacity: 0.6 },
});
