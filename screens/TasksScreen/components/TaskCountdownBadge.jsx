/**
 * TaskCountdownBadge (mobile)
 *
 * A small pill on a tree-view task row showing its live timer:
 *   • upcoming → blue countdown to its dueDate/time ("2h 15m", "3d")
 *   • started  → red NEGATIVE counter once it's passed ("-1h 30m")
 *   • today    → amber "Today" for an all-day task due today
 *   • pending  → muted "pending 5d" age since createdAt (no dueDate)
 *
 * One module-level 1s ticker drives every badge on screen; useTaskTimer
 * only re-renders when the visible label/state changes, so the badge
 * ticks in isolation without re-rendering its (memoized) TaskItem row.
 *
 * Note: mobile theme has no accentPrimary — upcoming uses accentInfo.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../context/ThemeContext';
import { getTaskTimer, timerLabel } from '../utils/taskHelpers';

// ── Shared 1s ticker ──────────────────────────────────────────────────
const tickSubs = new Set();
let tickTimer = null;
function ensureTicker() {
  if (!tickTimer) tickTimer = setInterval(() => tickSubs.forEach((f) => f()), 1000);
}
function subscribe(cb) {
  tickSubs.add(cb);
  ensureTicker();
  return () => {
    tickSubs.delete(cb);
    if (tickSubs.size === 0 && tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  };
}

export function useTaskTimer(task) {
  const compute = () => {
    const t = getTaskTimer(task, Date.now());
    return t ? { ...t, label: timerLabel(t) } : null;
  };
  const [timer, setTimer] = useState(compute);
  const ref = useRef(timer);

  useEffect(() => {
    const cb = () => {
      const next = compute();
      const prev = ref.current;
      const nextLabel = next ? next.label : '';
      const prevLabel = prev ? prev.label : '';
      const nextState = next ? next.state : '';
      const prevState = prev ? prev.state : '';
      if (nextLabel !== prevLabel || nextState !== prevState) {
        ref.current = next;
        setTimer(next);
      }
    };
    cb(); // sync to the latest `task` immediately
    return subscribe(cb);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task]);

  return timer;
}

const TaskCountdownBadge = ({ task }) => {
  const { theme } = useTheme();
  const timer = useTaskTimer(task);
  if (!timer) return null;

  const color =
    timer.state === 'started'
      ? theme.colors.accentError
      : timer.state === 'today'
        ? theme.colors.accentWarning
        : timer.state === 'pending'
          ? theme.colors.textTertiary
          : theme.colors.accentInfo;

  const icon =
    timer.state === 'pending'
      ? 'timer-sand'
      : timer.state === 'started'
        ? 'timer-alert-outline'
        : 'timer-outline';

  const text = timer.state === 'pending' ? `pending ${timer.label}` : timer.label;

  return (
    <View style={[styles.badge, { backgroundColor: `${color}1A` }]}>
      <Icon name={icon} size={11} color={color} />
      <Text style={[styles.text, { color }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 4,
  },
  text: {
    fontSize: 11,
    fontWeight: '700',
  },
});

export default React.memo(TaskCountdownBadge);
