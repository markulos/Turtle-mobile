// "Filter & arrange" — the vault's browse controls, in one card.
//
// It replaces a bare icon that flipped between a camera and a clock and
// silently reordered the grid. Nothing here changes the grid without a word
// attached to it.
//
// Presented as an IN-TREE OVERLAY, never a sibling <Modal>: the photos page is
// already an EdgeSwipePage overlay, and iOS refuses to present a second
// sibling modal over an open one (the FriendCard bug).
//
// Everything applies live. The footer button only dismisses — there is no
// "Apply", because the results are already visible behind the card.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { impactHaptic, tapHaptic } from '../../../utils/haptics';
import { useSheetDismiss } from '../../../utils/useSheetDismiss';
import { COLS_MAX, COLS_MIN } from '../../../utils/galleryFilters';

const OPEN_MS = 240;
const CLOSE_MS = 180;
const EASING = Easing.bezier(0.22, 1, 0.36, 1);

// ── Small shared pieces ────────────────────────────────────────────────────

function SectionLabel({ children, theme }) {
  return (
    <Text style={{
      fontSize: 11.5,
      fontWeight: '700',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      color: theme.colors.textTertiary,
      marginBottom: 8,
    }}>
      {children}
    </Text>
  );
}

/** iOS-style segmented control. Options are {value, label, icon?}. */
function Segmented({ options, value, onChange, theme }) {
  return (
    <View style={{
      flexDirection: 'row',
      backgroundColor: theme.colors.surfaceHighlight,
      borderRadius: 10,
      padding: 3,
      gap: 3,
    }}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <TouchableOpacity
            key={opt.value}
            activeOpacity={0.85}
            onPressIn={() => tapHaptic()}
            onPress={() => onChange(opt.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={opt.label}
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
              paddingVertical: 8,
              borderRadius: 8,
              backgroundColor: active ? theme.colors.surfaceElevated : 'transparent',
              borderWidth: active ? StyleSheet.hairlineWidth : 0,
              borderColor: theme.colors.border,
            }}
          >
            {!!opt.icon && (
              <Icon
                name={opt.icon}
                size={15}
                color={active ? theme.colors.primary : theme.colors.textTertiary}
              />
            )}
            <Text
              numberOfLines={1}
              style={{
                fontSize: 13,
                fontWeight: active ? '700' : '500',
                color: active ? theme.colors.textPrimary : theme.colors.textSecondary,
              }}
            >
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function Chip({ label, count, active, onPress, onRemove, theme }) {
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPressIn={() => tapHaptic()}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingVertical: 7,
        paddingHorizontal: 11,
        borderRadius: 999,
        backgroundColor: active ? theme.colors.primary : theme.colors.surfaceHighlight,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: active ? theme.colors.primary : theme.colors.border,
      }}
    >
      <Text
        numberOfLines={1}
        style={{
          fontSize: 13,
          fontWeight: active ? '700' : '500',
          maxWidth: 160,
          color: active ? theme.colors.background : theme.colors.textPrimary,
        }}
      >
        {label}
      </Text>
      {count != null && (
        <Text style={{
          fontSize: 11.5,
          fontWeight: '600',
          color: active ? theme.colors.background : theme.colors.textTertiary,
        }}>
          {count}
        </Text>
      )}
      {!!onRemove && (
        <Icon
          name="close-circle"
          size={14}
          color={active ? theme.colors.background : theme.colors.textTertiary}
        />
      )}
    </TouchableOpacity>
  );
}

// ── Month range: histogram + two thumbs ────────────────────────────────────

/**
 * The month buckets the server already computes for the timeline scrubber,
 * drawn as a count histogram with a draggable range over it. Free data — it is
 * the same payload the scene chips ride in on.
 *
 * Kept deliberately simple: tap a bar to set an end of the range. Two taps
 * define it. That reads better on a phone than two 6px thumbs, and it can't
 * fight the card's pull-down the way a vertical drag target would.
 */
function MonthRange({ buckets, from, to, onChange, theme }) {
  const months = useMemo(
    () => (buckets || [])
      .filter((b) => b.monthKey && b.monthKey !== 'unknown')
      .slice()
      .sort((a, b) => (a.monthKey < b.monthKey ? -1 : 1)),
    [buckets],
  );
  const max = useMemo(
    () => months.reduce((m, b) => Math.max(m, b.count || 0), 0),
    [months],
  );

  if (months.length < 2) return null;

  const boundsOf = (monthKey) => {
    const [y, m] = monthKey.split('-').map(Number);
    return { start: new Date(y, m - 1, 1).getTime(), end: new Date(y, m, 0, 23, 59, 59, 999).getTime() };
  };
  const inRange = (monthKey) => {
    const { start, end } = boundsOf(monthKey);
    if (from != null && end < from) return false;
    if (to != null && start > to) return false;
    return true;
  };

  const onTapMonth = (monthKey) => {
    const { start, end } = boundsOf(monthKey);
    impactHaptic('light');
    // First tap opens a range at that month; second tap closes it around both.
    if (from == null || to != null) {
      onChange({ from: start, to: end });
      return;
    }
    onChange(start < from ? { from: start, to } : { from, to: end });
  };

  const label = (monthKey) => {
    const [y, m] = monthKey.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  };

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 54, gap: 2 }}>
        {months.map((b) => {
          const on = inRange(b.monthKey);
          const h = max > 0 ? Math.max(3, Math.round((b.count / max) * 48)) : 3;
          return (
            <Pressable
              key={b.monthKey}
              onPress={() => onTapMonth(b.monthKey)}
              accessibilityRole="button"
              accessibilityLabel={`${label(b.monthKey)}, ${b.count} items`}
              style={{ flex: 1, justifyContent: 'flex-end', minWidth: 3 }}
            >
              <View style={{
                height: h,
                borderRadius: 2,
                backgroundColor: on ? theme.colors.primary : theme.colors.surfaceHighlight,
              }} />
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
        <Text style={{ fontSize: 11, color: theme.colors.textTertiary }}>
          {label(months[0].monthKey)}
        </Text>
        <Text style={{ fontSize: 11, color: theme.colors.textTertiary }}>
          {label(months[months.length - 1].monthKey)}
        </Text>
      </View>
    </View>
  );
}

// ── The sheet ──────────────────────────────────────────────────────────────

export default function GalleryFilterSheet({
  visible,
  theme,
  filters,
  chips,
  isDirty,
  facets,            // { buckets, sceneCounts, tagCounts }
  resultCount,
  totalCount,
  autoFocusSearch,
  bottomInset = 0,
  onChange,          // (patch) => void
  onToggleTag,
  onClearChip,
  onReset,
  onClose,
}) {
  const c = theme.colors;
  const [mounted, setMounted] = useState(visible);
  const anim = useRef(new Animated.Value(0)).current;
  const searchRef = useRef(null);
  const [showAllTags, setShowAllTags] = useState(false);

  const { panHandlers, scrollProps, dragY } = useSheetDismiss(onClose, visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setShowAllTags(false);
      Animated.timing(anim, {
        toValue: 1, duration: OPEN_MS, easing: EASING, useNativeDriver: true,
      }).start();
    } else if (mounted) {
      Animated.timing(anim, {
        toValue: 0, duration: CLOSE_MS, easing: EASING, useNativeDriver: true,
      }).start(({ finished }) => { if (finished) setMounted(false); });
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (visible && autoFocusSearch) {
      // One frame after the entrance starts, or iOS drops the focus request.
      const t = setTimeout(() => searchRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [visible, autoFocusSearch]);

  const tagEntries = useMemo(() => {
    const counts = facets?.tagCounts || {};
    return Object.entries(counts)
      .filter(([name]) => name && name !== 'All')
      .sort((a, b) => b[1] - a[1]);
  }, [facets]);

  const sceneEntries = useMemo(() => {
    const counts = facets?.sceneCounts || {};
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [facets]);

  if (!mounted) return null;

  const visibleTags = showAllTags ? tagEntries : tagEntries.slice(0, 8);
  const filtered = resultCount != null && totalCount != null && resultCount !== totalCount;

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 80 }]} pointerEvents="box-none">
      {/* Scrim. Fades with the entrance AND with the drag, so pulling the card
          down brightens the results underneath as they come back into view. */}
      <Animated.View
        pointerEvents={visible ? 'auto' : 'none'}
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: 'rgba(0,0,0,0.5)',
            opacity: Animated.multiply(
              anim,
              dragY.interpolate({ inputRange: [0, 400], outputRange: [1, 0], extrapolate: 'clamp' }),
            ),
          },
        ]}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityLabel="Close filter and arrange"
          onPress={onClose}
        />
      </Animated.View>

      <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
        <Animated.View
          {...panHandlers}
          style={{
            maxHeight: '82%',
            backgroundColor: c.surfaceElevated,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderColor: c.border,
            paddingBottom: bottomInset,
            transform: [
              { translateY: Animated.add(
                anim.interpolate({ inputRange: [0, 1], outputRange: [600, 0] }),
                dragY,
              ) },
            ],
          }}
        >
          {/* Handle + title + live count */}
          <View style={{ paddingTop: 8, paddingHorizontal: 18 }}>
            <View style={{
              alignSelf: 'center', width: 38, height: 4, borderRadius: 2,
              backgroundColor: c.borderStrong, marginBottom: 12,
            }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 17, fontWeight: '700', color: c.textPrimary }}>
                  Filter &amp; arrange
                </Text>
                <Text style={{ fontSize: 12, color: c.textTertiary, marginTop: 1 }}>
                  {filtered
                    ? `${resultCount} of ${totalCount} items`
                    : `${totalCount ?? resultCount ?? 0} items`}
                </Text>
              </View>
              {isDirty && (
                <TouchableOpacity
                  onPressIn={() => tapHaptic()}
                  onPress={onReset}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityRole="button"
                  accessibilityLabel="Reset all filters"
                >
                  <Text style={{ fontSize: 14, fontWeight: '600', color: c.primary }}>Reset</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          <ScrollView
            style={{ marginTop: 14 }}
            contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 18, gap: 20 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator
            scrollIndicatorInsets={{ right: 1 }}
            indicatorStyle={theme.mode === 'dark' ? 'white' : 'black'}
            {...scrollProps}
          >
            {/* Search */}
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              height: 42,
              paddingHorizontal: 12,
              borderRadius: 11,
              backgroundColor: c.surfaceHighlight,
            }}>
              <Icon name="magnify" size={18} color={c.textMuted} />
              <TextInput
                ref={searchRef}
                value={filters.q}
                onChangeText={(t) => onChange({ q: t })}
                placeholder="Search photos, tags, text…"
                placeholderTextColor={c.textMuted}
                returnKeyType="search"
                // Explicit height + zero vertical padding: RN glyphs ride high
                // in a padded inline input.
                style={{
                  flex: 1,
                  height: 42,
                  paddingVertical: 0,
                  textAlignVertical: 'center',
                  fontSize: 15,
                  color: c.textPrimary,
                }}
              />
              {!!filters.q && (
                <TouchableOpacity onPress={() => onChange({ q: '' })} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Icon name="close-circle" size={17} color={c.textMuted} />
                </TouchableOpacity>
              )}
            </View>

            {/* Active filters */}
            {chips.length > 0 && (
              <View>
                <SectionLabel theme={theme}>Active</SectionLabel>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {chips.map((chip) => (
                    <Chip
                      key={chip.key}
                      label={chip.label}
                      active
                      onRemove
                      onPress={() => onClearChip(chip.key)}
                      theme={theme}
                    />
                  ))}
                </View>
              </View>
            )}

            {/* Order by — the control the old camera/clock icon was hiding */}
            <View>
              <SectionLabel theme={theme}>Order by</SectionLabel>
              <Segmented
                theme={theme}
                value={filters.sortBy}
                onChange={(v) => onChange({ sortBy: v })}
                options={[
                  { value: 'original', label: 'Capture date', icon: 'camera-outline' },
                  { value: 'upload', label: 'Date added', icon: 'clock-plus-outline' },
                ]}
              />
            </View>

            <View>
              <SectionLabel theme={theme}>Direction</SectionLabel>
              <Segmented
                theme={theme}
                value={filters.direction}
                onChange={(v) => onChange({ direction: v })}
                options={[
                  { value: 'desc', label: 'Newest first', icon: 'arrow-down' },
                  { value: 'asc', label: 'Oldest first', icon: 'arrow-up' },
                ]}
              />
            </View>

            <View>
              <SectionLabel theme={theme}>Show</SectionLabel>
              <Segmented
                theme={theme}
                value={filters.mediaType}
                onChange={(v) => onChange({ mediaType: v })}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'photo', label: 'Photos', icon: 'image-outline' },
                  { value: 'video', label: 'Videos', icon: 'play-circle-outline' },
                ]}
              />
            </View>

            {/* Time */}
            <View>
              <SectionLabel theme={theme}>Time</SectionLabel>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                <Chip
                  label="All time"
                  active={filters.from == null && filters.to == null}
                  onPress={() => onChange({ from: null, to: null })}
                  theme={theme}
                />
                <Chip
                  label="This year"
                  active={false}
                  onPress={() => {
                    const y = new Date().getFullYear();
                    onChange({ from: new Date(y, 0, 1).getTime(), to: new Date(y, 11, 31, 23, 59, 59, 999).getTime() });
                  }}
                  theme={theme}
                />
                <Chip
                  label="Last 12 months"
                  active={false}
                  onPress={() => {
                    const now = new Date();
                    const from = new Date(now.getFullYear(), now.getMonth() - 11, 1).getTime();
                    onChange({ from, to: now.getTime() });
                  }}
                  theme={theme}
                />
              </View>
              <MonthRange
                buckets={facets?.buckets}
                from={filters.from}
                to={filters.to}
                onChange={onChange}
                theme={theme}
              />
            </View>

            {/* Tag facets */}
            {tagEntries.length > 0 && (
              <View>
                <SectionLabel theme={theme}>Tags</SectionLabel>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {visibleTags.map(([name, count]) => (
                    <Chip
                      key={name}
                      label={name}
                      count={count}
                      active={filters.tag.includes(name)}
                      onPress={() => onToggleTag(name)}
                      theme={theme}
                    />
                  ))}
                  {tagEntries.length > visibleTags.length && (
                    <Chip
                      label={`+${tagEntries.length - visibleTags.length} more`}
                      onPress={() => setShowAllTags(true)}
                      theme={theme}
                    />
                  )}
                </View>
              </View>
            )}

            {/* Scene facets — hidden entirely when the AI labeller has nothing
                to say about this scope, rather than showing an empty section. */}
            {sceneEntries.length > 0 && (
              <View>
                <SectionLabel theme={theme}>Kind of shot</SectionLabel>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {sceneEntries.map(([name, count]) => (
                    <Chip
                      key={name}
                      label={name}
                      count={count}
                      active={filters.sceneType === name}
                      onPress={() => onChange({ sceneType: filters.sceneType === name ? null : name })}
                      theme={theme}
                    />
                  ))}
                </View>
              </View>
            )}

            {/* Density — the pinch gesture, made discoverable */}
            <View>
              <SectionLabel theme={theme}>Layout</SectionLabel>
              <Segmented
                theme={theme}
                value={filters.cols}
                onChange={(v) => onChange({ cols: v })}
                options={Array.from({ length: COLS_MAX - COLS_MIN + 1 }, (_, i) => ({
                  value: COLS_MIN + i,
                  label: String(COLS_MIN + i),
                }))}
              />
            </View>
          </ScrollView>

          {/* Footer. Everything is already applied — this only gets out of the
              way, so it says what you'll be looking at, not "Apply". */}
          <View style={{
            paddingHorizontal: 18,
            paddingTop: 10,
            paddingBottom: 10,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: c.border,
          }}>
            <TouchableOpacity
              activeOpacity={0.85}
              onPressIn={() => impactHaptic('medium')}
              onPress={onClose}
              accessibilityRole="button"
              style={{
                height: 46,
                borderRadius: 13,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: c.primary,
              }}
            >
              <Text style={{ fontSize: 15, fontWeight: '700', color: c.background }}>
                {resultCount != null ? `Show ${resultCount} item${resultCount === 1 ? '' : 's'}` : 'Done'}
              </Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </View>
  );
}
