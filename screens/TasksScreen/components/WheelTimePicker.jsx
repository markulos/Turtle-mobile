import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Modal,
  Pressable,
  Dimensions,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../../context/ThemeContext';
import { useSheetDismiss } from '../../../utils/useSheetDismiss';

/**
 * WheelTimePicker — a slick iOS-style scrolling-wheel time picker.
 *
 * Built entirely in JS (no native @react-native-community/datetimepicker,
 * which would force a dev-build rebuild) so it drops straight into the Expo
 * Go / current dev build. Three momentum-snap wheels (Hour · Minute · AM/PM)
 * with the classic curved falloff — rows fade, shrink and tilt away from the
 * centred selection — plus a haptic tick each time a new value rolls under
 * the selection band, exactly like the native UIDatePicker.
 *
 * Presented as a bottom action-sheet that slides up over a dimmed backdrop.
 *
 * Props:
 *   visible      — show/hide
 *   initialTime  — "HH:MM" (24h) to preselect; falls back to now
 *   onSelect     — (timeStr | null) => void. "HH:MM" 24h on Set, null on Clear
 *   onClose      — () => void
 */

const { height: SCREEN_H } = Dimensions.get('window');

const ITEM_HEIGHT = 44;
const VISIBLE_ROWS = 5; // odd so there's a clear centre
const WHEEL_HEIGHT = ITEM_HEIGHT * VISIBLE_ROWS;
const PAD_ROWS = Math.floor(VISIBLE_ROWS / 2); // padding so first/last can centre

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1); // 1..12
const MINUTES = Array.from({ length: 60 }, (_, i) => i); // 0..59
const PERIODS = ['AM', 'PM'];

// ── A single momentum-snap wheel column ──────────────────────────────
const WheelColumn = ({ data, initialIndex, onIndexChange, renderLabel, theme, width, align }) => {
  const scrollRef = useRef(null);
  const scrollY = useRef(new Animated.Value(initialIndex * ITEM_HEIGHT)).current;
  const lastIdxRef = useRef(initialIndex);

  // Land on the initial value without animation on mount.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: initialIndex * ITEM_HEIGHT, animated: false });
    });
    return () => cancelAnimationFrame(id);
    // mount-only: re-seeding on every initialIndex change would fight the user
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Native-driven scroll feeds the falloff transforms; the JS listener fires a
  // selection tick whenever the centred row changes (the wheel "click").
  const onScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
        useNativeDriver: true,
        listener: (e) => {
          const idx = Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT);
          if (idx !== lastIdxRef.current && idx >= 0 && idx < data.length) {
            lastIdxRef.current = idx;
            Haptics.selectionAsync().catch(() => {});
          }
        },
      }),
    [scrollY, data.length],
  );

  const commit = useCallback(
    (e) => {
      const raw = Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT);
      const idx = Math.max(0, Math.min(data.length - 1, raw));
      onIndexChange(idx);
    },
    [data.length, onIndexChange],
  );

  return (
    <View style={{ width, height: WHEEL_HEIGHT }}>
      <Animated.ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        scrollEventThrottle={16}
        onScroll={onScroll}
        onMomentumScrollEnd={commit}
        onScrollEndDrag={commit}
        contentContainerStyle={{ paddingVertical: PAD_ROWS * ITEM_HEIGHT }}
      >
        {data.map((item, i) => {
          const inputRange = [
            (i - 2) * ITEM_HEIGHT,
            (i - 1) * ITEM_HEIGHT,
            i * ITEM_HEIGHT,
            (i + 1) * ITEM_HEIGHT,
            (i + 2) * ITEM_HEIGHT,
          ];
          const opacity = scrollY.interpolate({
            inputRange,
            outputRange: [0.15, 0.45, 1, 0.45, 0.15],
            extrapolate: 'clamp',
          });
          const scale = scrollY.interpolate({
            inputRange,
            outputRange: [0.82, 0.9, 1, 0.9, 0.82],
            extrapolate: 'clamp',
          });
          const rotateX = scrollY.interpolate({
            inputRange,
            outputRange: ['52deg', '26deg', '0deg', '-26deg', '-52deg'],
            extrapolate: 'clamp',
          });
          return (
            <Animated.View
              key={i}
              style={{
                height: ITEM_HEIGHT,
                justifyContent: 'center',
                alignItems: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
                paddingHorizontal: 6,
                opacity,
                transform: [{ perspective: 700 }, { rotateX }, { scale }],
              }}
            >
              <Text
                style={{
                  fontSize: 26,
                  fontWeight: '500',
                  color: theme.colors.textPrimary,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {renderLabel(item)}
              </Text>
            </Animated.View>
          );
        })}
      </Animated.ScrollView>
    </View>
  );
};

export const WheelTimePicker = ({ visible, initialTime, onSelect, onClose }) => {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  // Selection indices, seeded from initialTime (or now) each time we open.
  const [hourIdx, setHourIdx] = useState(0);
  const [minIdx, setMinIdx] = useState(0);
  const [periodIdx, setPeriodIdx] = useState(0);
  // Bump on each open so the wheels remount and re-seed to the new value.
  const [seed, setSeed] = useState(0);

  const backdrop = useRef(new Animated.Value(0)).current;
  const sheetY = useRef(new Animated.Value(SCREEN_H)).current;

  useEffect(() => {
    if (!visible) return;
    let h24, m;
    if (initialTime && /^\d{1,2}:\d{2}/.test(initialTime)) {
      [h24, m] = initialTime.split(':').map(Number);
    } else {
      const now = new Date();
      h24 = now.getHours();
      m = now.getMinutes();
    }
    const pm = h24 >= 12;
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    setHourIdx(h12 - 1);
    setMinIdx(Math.max(0, Math.min(59, m)));
    setPeriodIdx(pm ? 1 : 0);
    setSeed((s) => s + 1);

    backdrop.setValue(0);
    sheetY.setValue(SCREEN_H);
    Animated.parallel([
      Animated.timing(backdrop, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.spring(sheetY, { toValue: 0, useNativeDriver: true, damping: 22, stiffness: 240, mass: 0.9 }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialTime]);

  const animateOut = useCallback(
    (after) => {
      Animated.parallel([
        Animated.timing(backdrop, { toValue: 0, duration: 180, useNativeDriver: true }),
        Animated.timing(sheetY, { toValue: SCREEN_H, duration: 220, useNativeDriver: true }),
      ]).start(() => after && after());
    },
    [backdrop, sheetY],
  );

  const buildTimeString = useCallback(() => {
    const h12 = hourIdx + 1;
    const pm = periodIdx === 1;
    let h24;
    if (pm) h24 = h12 === 12 ? 12 : h12 + 12;
    else h24 = h12 === 12 ? 0 : h12;
    return `${String(h24).padStart(2, '0')}:${String(minIdx).padStart(2, '0')}`;
  }, [hourIdx, minIdx, periodIdx]);

  const handleSet = useCallback(() => {
    const t = buildTimeString();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    animateOut(() => {
      onSelect?.(t);
      onClose?.();
    });
  }, [buildTimeString, animateOut, onSelect, onClose]);

  const handleClear = useCallback(() => {
    animateOut(() => {
      onSelect?.(null);
      onClose?.();
    });
  }, [animateOut, onSelect, onClose]);

  const handleCancel = useCallback(() => animateOut(() => onClose?.()), [animateOut, onClose]);

  // iOS-style pull-down on the grabber/header strip (composes with the
  // sheet's own slide-up entrance — two translateY entries add).
  const { panHandlers, sheetDragStyle } = useSheetDismiss(handleCancel, visible);

  // Live preview string in the header ("3:45 PM").
  const previewLabel = useMemo(() => {
    const h12 = hourIdx + 1;
    return `${h12}:${String(minIdx).padStart(2, '0')} ${PERIODS[periodIdx]}`;
  }, [hourIdx, minIdx, periodIdx]);

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={handleCancel} statusBarTranslucent>
      <View style={styles.root}>
        <Animated.View style={[styles.backdrop, { opacity: backdrop }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={handleCancel} />
        </Animated.View>

        <Animated.View style={[styles.sheet, { transform: [{ translateY: sheetY }, ...sheetDragStyle.transform] }]}>
          {/* Grabber + header = the pull-down-to-close zone. Restricted to
              this strip so the wheels' own vertical scrolling never fights it. */}
          <View {...panHandlers}>
            <View style={styles.grabber} />

            {/* Header: cancel · live preview · set */}
            <View style={styles.header}>
              <TouchableOpacity onPress={handleCancel} hitSlop={HIT} style={styles.headerSide}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.preview}>{previewLabel}</Text>
              <TouchableOpacity onPress={handleSet} hitSlop={HIT} style={[styles.headerSide, styles.headerSideRight]}>
                <Text style={styles.setText}>Set</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Wheels */}
          <View style={styles.wheels}>
            {/* Centre selection band (behind the rows) */}
            <View pointerEvents="none" style={styles.selectionBand} />

            <WheelColumn
              key={`h-${seed}`}
              data={HOURS}
              initialIndex={hourIdx}
              onIndexChange={setHourIdx}
              renderLabel={(h) => String(h)}
              theme={theme}
              width={62}
              align="right"
            />
            <Text style={styles.colon}>:</Text>
            <WheelColumn
              key={`m-${seed}`}
              data={MINUTES}
              initialIndex={minIdx}
              onIndexChange={setMinIdx}
              renderLabel={(m) => String(m).padStart(2, '0')}
              theme={theme}
              width={62}
              align="left"
            />
            <WheelColumn
              key={`p-${seed}`}
              data={PERIODS}
              initialIndex={periodIdx}
              onIndexChange={setPeriodIdx}
              renderLabel={(p) => p}
              theme={theme}
              width={70}
              align="center"
            />
          </View>

          <TouchableOpacity onPress={handleClear} style={styles.clearBtn} hitSlop={HIT}>
            <Text style={styles.clearText}>Clear time</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
};

const HIT = { top: 10, bottom: 10, left: 12, right: 12 };

const createStyles = (theme) =>
  StyleSheet.create({
    root: { flex: 1, justifyContent: 'flex-end' },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
    sheet: {
      backgroundColor: theme.colors.surfaceElevated,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingBottom: 34, // home-indicator safe space
      paddingTop: 10,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -6 },
      shadowOpacity: 0.4,
      shadowRadius: 24,
      elevation: 24,
    },
    grabber: {
      alignSelf: 'center',
      width: 38,
      height: 5,
      borderRadius: 3,
      backgroundColor: theme.colors.textMuted,
      marginBottom: 6,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 18,
      paddingVertical: 10,
    },
    headerSide: { minWidth: 64 },
    headerSideRight: { alignItems: 'flex-end' },
    cancelText: { fontSize: 16, color: theme.colors.textSecondary, fontWeight: '500' },
    setText: { fontSize: 16, color: theme.colors.accentInfo, fontWeight: '700' },
    preview: {
      fontSize: 17,
      color: theme.colors.textPrimary,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
    wheels: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      height: WHEEL_HEIGHT,
      marginTop: 4,
      position: 'relative',
    },
    selectionBand: {
      position: 'absolute',
      left: 24,
      right: 24,
      top: PAD_ROWS * ITEM_HEIGHT,
      height: ITEM_HEIGHT,
      borderRadius: 12,
      backgroundColor: theme.colors.surfaceHighlight,
    },
    colon: {
      fontSize: 26,
      fontWeight: '600',
      color: theme.colors.textPrimary,
      marginHorizontal: 2,
      marginBottom: 2,
    },
    clearBtn: {
      alignSelf: 'center',
      marginTop: 14,
      paddingVertical: 8,
      paddingHorizontal: 18,
    },
    clearText: { fontSize: 14, color: theme.colors.textTertiary, fontWeight: '500' },
  });

export default WheelTimePicker;
