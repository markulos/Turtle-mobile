import React from 'react';
import { StyleSheet, View } from 'react-native';
import { TAB_ICON_SLOT } from './tabBarLayout';
import Reanimated, {
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
} from 'react-native-reanimated';

/**
 * TabBarIcon — the bottom nav's active-state treatment.
 *
 * Deliberately built as an ICON wrapper rather than a custom `tabBarButton`.
 * Replacing the button means taking over react-navigation's contract for
 * layout, selection state and accessibility, and getting any part of it wrong
 * silently empties the bar — the button's `style` carries the flex that sizes
 * the tab, and v7 reports selection as `aria-selected` rather than through
 * accessibilityState. `tabBarIcon` is the stable surface: its return value is
 * placed inside navigation's own button, so sizing, hit area, ripple, a11y and
 * press behaviour all stay untouched.
 *
 * What it adds: the icon takes its active ink, lifts slightly and swells 4%
 * as it becomes active. The HIGHLIGHT itself is not here: it is one pill that
 * slides between tabs (TabBarPill), painted behind these icons.
 *
 * ── THE ICON FOLLOWS THE CHIP, NOT THE NAVIGATOR ───────────────────────────
 *
 * It used to follow `focused`: the colour was whatever tint react-navigation
 * handed over, and the swell was a spring started when that prop flipped.
 * `focused` only changes when React COMMITS the tab change — and by then the
 * chip, which leaves on the touch, has usually arrived. So the chip slid
 * under a glyph that was still in its resting ink, and a moment later the
 * glyph changed colour in a single frame and popped. Two clocks, and the
 * second one was a step.
 *
 * Now there is one. `chipPos` is where the chip actually IS, as a fractional
 * slot, on the UI thread (TabBarPill writes it every frame it moves). Each
 * icon works out how much of the chip is under it —
 *
 *   on = 1 when the chip is centred on this slot, 0 a whole slot away
 *
 * — and both the ink and the swell are that one number. The icon is drawn
 * TWICE, resting ink under active ink, and cross-fades between them, because
 * a glyph's colour cannot be animated on the UI thread but an opacity can.
 * So the ink arrives exactly as the chip does, at the chip's own speed, and
 * a busy JS thread cannot make it late or abrupt.
 *
 * ONLY THE TWO ENDS OF A TRAVEL CHANGE, though: the tab being left and the
 * tab being arrived at (`chipFrom` / `chipTo`). A glyph the chip merely
 * passes over on a long move keeps its resting ink — lighting each one in
 * turn made a long move look like five selections instead of one. Under a
 * dragging thumb there are no ends, and whichever icon the chip is over
 * lights, because there the chip can stop anywhere.
 *
 * Before the chip's position is known (`chipPos` < 0: first frame, a test, a
 * harness without the pill) it falls back to `focused`, as a step.
 */

// How much bigger an active glyph is, and how far it lifts.
const SWELL = 0.04;
const LIFT = 1;

export default function TabBarIcon({
  focused, brand = false, slot, chipPos, chipFrom, chipTo, active, inactive, badge, children,
}) {
  const ownPos = useSharedValue(-1);
  const pos = chipPos ?? ownPos;
  // The two ends of the chip's travel (TabBarPill). -2 = no ends: light by
  // position alone, which is what a dragging thumb wants.
  const ownFrom = useSharedValue(-2);
  const ownTo = useSharedValue(-2);
  const from = chipFrom ?? ownFrom;
  const to = chipTo ?? ownTo;
  const fallback = focused ? 1 : 0;
  const index = Number.isInteger(slot) ? slot : -1;

  // 0..1 — how much of the chip is under this icon. Smoothstepped, so the ink
  // starts and finishes gently instead of ramping in a straight line.
  const on = useDerivedValue(() => {
    const p = pos.value;
    if (p < -0.5 || index < 0) return fallback;
    // ONLY THE ENDS CHANGE. On a travel, the icon being left fades out as the
    // chip pulls away and the one being arrived at fades in as it lands; an
    // icon the chip merely passes over on the way keeps its resting ink.
    const end = to.value;
    if (end !== -2 && index !== end && index !== from.value) return 0;
    const t = Math.max(0, 1 - Math.abs(p - index));
    return t * t * (3 - 2 * t);
  }, [fallback, index]);

  // The centring transform lives HERE rather than in a static style: when two
  // styles are merged, a later `transform` REPLACES an earlier one wholesale.
  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + SWELL * on.value }, { translateY: -LIFT * on.value }],
  }));
  const activeStyle = useAnimatedStyle(() => ({ opacity: on.value }));
  const inactiveStyle = useAnimatedStyle(() => ({ opacity: 1 - on.value }));

  const layered = active != null && inactive != null;

  return (
    <View style={styles.slot} pointerEvents="none" testID={brand ? 'tab-icon-brand' : undefined}>
      <Reanimated.View style={iconStyle}>
        {layered ? (
          <>
            <Reanimated.View style={inactiveStyle}>{inactive}</Reanimated.View>
            <Reanimated.View style={[styles.over, activeStyle]}>{active}</Reanimated.View>
            {badge}
          </>
        ) : children}
      </Reanimated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // A REAL, in-flow square — this is the load-bearing part.
  //
  // The previous version made this absoluteFill so it would "fill the button".
  // An absolutely-positioned child contributes NO layout size, so v7's button
  // (justifyContent: 'flex-start', padding: 5) had no in-flow content and
  // collapsed to 10pt tall, pinned to the top of the bar — which is exactly why
  // the glyphs kept sitting high however the bar was padded.
  //
  // Giving the slot a real TAB_ICON_SLOT square makes the button measure
  // 5 + slot + 5 = PILL_SIZE: it fills the bar's inner box, and the glyph
  // centres inside it. Dead centre on the chip AND on the dock.
  slot: {
    width: TAB_ICON_SLOT,
    height: TAB_ICON_SLOT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The active ink, laid exactly over the resting one. The resting layer is
  // in flow and gives the pair its size; this one only paints.
  over: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
