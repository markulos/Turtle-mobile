/**
 * SearchScopeToggle — "My library | Web", above the results.
 *
 * One lit pill GLIDES between the two keys on the UI thread, which is the same
 * segmented-thumb motion as the Tasks header's status keys and the calendar's
 * list toggle (see TasksScreen/components/StatusSegment). A fill that snapped
 * from key to key would be the only control in the app that did.
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
  // Each key reports its frame once laid out; the pill is driven from those,
  // so the two keys can be different widths without measuring any text.
  const [frames, setFrames] = useState({});
  const pillX = useSharedValue(0);
  const pillW = useSharedValue(0);
  const settledRef = useRef(false);
  const frame = frames[value];

  useEffect(() => {
    if (!frame) return;
    if (!settledRef.current) {
      // First layout: place the pill without motion, or it flies in from the
      // left edge every time search is opened.
      pillX.value = frame.x;
      pillW.value = frame.width;
      settledRef.current = true;
      return;
    }
    pillX.value = withTiming(frame.x, { duration: SLIDE_MS, easing: SLIDE_EASE });
    pillW.value = withTiming(frame.width, { duration: SLIDE_MS, easing: SLIDE_EASE });
  }, [frame, pillX, pillW]);

  const pillStyle = useAnimatedStyle(() => ({
    width: pillW.value,
    transform: [{ translateX: pillX.value }],
    opacity: pillW.value > 0 ? 1 : 0,
  }));

  return (
    <View style={[styles.box, { borderColor: c.borderStrong || c.border }]} accessibilityRole="tablist" testID={testID}>
      <Reanimated.View pointerEvents="none" style={[styles.pill, { backgroundColor: c.textPrimary }, pillStyle]} />
      {options.map((o) => {
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
            style={({ pressed }) => [styles.key, pressed && !on && styles.pressed]}
          >
            <Text style={[styles.keyText, { color: on ? c.background : c.textTertiary }]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default memo(SearchScopeToggle);

const styles = StyleSheet.create({
  // flex:1 keys in a full-width box: two halves, so the pill's travel reads as
  // a switch rather than as a cursor landing on words of unequal length.
  box: { flexDirection: 'row', height: 32, borderRadius: 9, borderWidth: 1, padding: 2, gap: 2 },
  pill: { position: 'absolute', top: 2, bottom: 2, left: 0, borderRadius: 7 },
  key: { flex: 1, paddingHorizontal: 8, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  keyText: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.9, textTransform: 'uppercase' },
  pressed: { opacity: 0.6 },
});
