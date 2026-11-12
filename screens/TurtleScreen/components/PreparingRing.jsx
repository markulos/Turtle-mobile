/**
 * The determinate stand-in for a spinner while a track is being found.
 *
 * Same footprint as the ActivityIndicator it replaces, so nothing moves when
 * the wait starts or ends. A spinner says "something is happening"; this says
 * how far in it is, which is the difference between a wait you can sit through
 * and one you press the button again during.
 *
 * The percentage is NOT written inside the ring — at this size it would be
 * four points of unreadable type. The arc carries it here and the words carry
 * it on the line underneath (see MusicWebResultRow), which is the place
 * already saying what the wait is for.
 *
 * services/preparingProgress.js is where the number comes from, and says which
 * half of it is measured and which half is an estimate.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

const SIZE = 20;
const STROKE = 2.5;
const R = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * R;

/** Opening gap so a ring at 0% still reads as a ring, not a dot. */
const MIN_SWEEP = 0.04;

function PreparingRing({ percent = 0, tint, track }) {
  const fraction = Math.max(MIN_SWEEP, Math.min(1, (Number(percent) || 0) / 100));
  return (
    // A VALUE and no words. Both places this appears sit inside something that
    // already says "Finding the audio... 42%" — the row, and the transport
    // bar's play button — so a label here would be the same sentence read out
    // twice for one wait.
    <View
      style={styles.box}
      // An element in its own right, or the role and the value are decoration
      // that nothing reads — including the tests.
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(Number(percent) || 0) }}
    >
      <Svg width={SIZE} height={SIZE}>
        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          stroke={track}
          strokeWidth={STROKE}
          fill="none"
        />
        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          stroke={tint}
          strokeWidth={STROKE}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${CIRCUMFERENCE * fraction} ${CIRCUMFERENCE}`}
          // From twelve o'clock, like every other progress ring and every
          // clock face. SVG arcs start at three.
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      </Svg>
    </View>
  );
}

export default React.memo(PreparingRing);

const styles = StyleSheet.create({
  // The ActivityIndicator's own small size, so swapping one for the other
  // cannot shift the row.
  box: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
});
