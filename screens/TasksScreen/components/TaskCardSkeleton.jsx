import React from 'react';
import { View, Animated } from 'react-native';
import { UNIFORM_CARD_H } from './TimelineTaskRow';

// ── Lazy-load task-card skeleton ──────────────────────────────
//
// Same shape as the Upcoming agenda's past-zone placeholder (index.jsx
// PastPlaceholderRow): a rail (connecting line + hollow "unloaded" dot) plus a
// pulsing card with when / title / subtitle bars, locked to UNIFORM_CARD_H so it
// stands in for a TimelineTaskRow with minimal reflow when the real row fills.
// Used by the calendar day pane to lazily fill its long To-Do / Pending lists.

// ONE shared native-driver pulse for every mounted skeleton. The first skeleton
// starts it from an effect; the last cleanup stops it, so rendering stays pure
// and no animation survives after the loading frontier unmounts.
const sharedPulse = new Animated.Value(0.45);
let sharedLoop = null;
let pulseUsers = 0;

function useSharedPulse() {
  React.useEffect(() => {
    pulseUsers += 1;
    if (!sharedLoop) {
      sharedLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(sharedPulse, { toValue: 1, duration: 620, useNativeDriver: true }),
          Animated.timing(sharedPulse, { toValue: 0.45, duration: 620, useNativeDriver: true }),
        ]),
      );
      sharedLoop.start();
    }

    return () => {
      pulseUsers = Math.max(0, pulseUsers - 1);
      if (pulseUsers === 0 && sharedLoop) {
        sharedLoop.stop();
        sharedLoop = null;
        sharedPulse.setValue(0.45);
      }
    };
  }, []);

  return sharedPulse;
}

export function TaskCardSkeleton({ theme, isFirst, isLast }) {
  const pulse = useSharedPulse();
  const block = theme.colors.border;
  const rail = theme.mode === 'dark' ? '#FFFFFF' : '#000000';
  const card = theme.mode === 'dark' ? theme.colors.surfaceHighlight : theme.colors.surface;
  const bar = (w, h, extra) => ({ width: w, height: h, borderRadius: h / 2, backgroundColor: block, ...(extra || {}) });
  return (
    <View style={{ flexDirection: 'row', marginBottom: 12, paddingHorizontal: 14 }} pointerEvents="none">
      {/* Rail — strong connecting line + a hollow dot where the toggle sits. */}
      <View style={{ width: 40, alignSelf: 'stretch', alignItems: 'center' }}>
        {!isFirst && <View style={{ position: 'absolute', left: 19, top: 0, height: 20, width: 2, backgroundColor: rail }} />}
        {!isLast && <View style={{ position: 'absolute', left: 19, top: 20, bottom: -12, width: 2, backgroundColor: rail }} />}
        <View style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: card, borderWidth: 1.5, borderColor: block }} />
        </View>
      </View>
      {/* Card — locked to the uniform card height; when / title / subtitle bars. */}
      <Animated.View
        style={{
          flex: 1,
          marginLeft: 12,
          height: UNIFORM_CARD_H,
          overflow: 'hidden',
          justifyContent: 'center',
          backgroundColor: card,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: theme.colors.border,
          paddingHorizontal: 12,
          opacity: pulse,
        }}
      >
        <View style={bar('30%', 10, { marginBottom: 9 })} />
        <View style={bar('68%', 13, { marginBottom: 8 })} />
        <View style={bar('42%', 11)} />
      </Animated.View>
    </View>
  );
}

// A short cluster of skeleton rows shown at the loading frontier of a lazily
// filled list (a ScrollView can't cheaply render one-per-overflow-item like the
// virtualized agenda, so a small cluster stands in until the section-local
// "Show more" control advances its frontier). `remaining` caps the cluster so
// it never shows more than are left.
export function TaskCardSkeletonCluster({ theme, remaining, rows = 3 }) {
  const n = Math.max(0, Math.min(rows, remaining));
  if (n === 0) return null;
  return (
    <View>
      {Array.from({ length: n }).map((_, i) => (
        <TaskCardSkeleton key={`sk-${i}`} theme={theme} isFirst={i === 0} isLast={i === n - 1} />
      ))}
    </View>
  );
}
