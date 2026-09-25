/**
 * PdfIndexPanel — the reader's index: a drawer over the left of the page that
 * turns "‹ › forty times" into one tap.
 *
 * The page keys are fine for a five-page scan and useless for a 300-page
 * report, which is what this is for. It shows the document's own table of
 * contents where there is one (nested, indented, page numbers down the right),
 * and a plain page list where there isn't — and the page list stays available
 * either way, because a TOC that stops at chapter headings still can't get you
 * to page 214.
 *
 * LEFT, not right: it is a table of contents, and every reader that has one
 * (Books, Preview, Acrobat) puts it there. The page's own left-edge back-swipe
 * is disabled by the caller while this is open, so the two gestures on that
 * edge cannot fight.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tapHaptic } from '../../../../utils/haptics';
import { activeOutlineKey } from './pdfOutline';

const MAX_W = 340;
const WIDTH_RATIO = 0.84;
const ROW_H = 46;

export default function PdfIndexPanel({ visible, rows, pageCount, page, mode, onModeChange, onPick, onClose, theme }) {
  const c = theme.colors;
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const panelW = Math.min(MAX_W, width * WIDTH_RATIO);
  const tx = useRef(new Animated.Value(-panelW)).current;
  const listRef = useRef(null);

  const hasOutline = (rows || []).length > 0;
  const showing = hasOutline ? mode : 'pages';
  const activeKey = useMemo(() => (hasOutline ? activeOutlineKey(rows, page) : null), [hasOutline, rows, page]);

  const pages = useMemo(
    () => Array.from({ length: Math.max(0, pageCount || 0) }, (_, i) => i + 1),
    [pageCount],
  );

  // Stays mounted through the slide-OUT, then unmounts — a drawer parked
  // off-screen but still in the tree is a full-screen layer over the document.
  // Same reasoning (and the same interruption trap) as EdgeSwipePage's own
  // mount latch: unmount on the ref, not on the animation's `finished`, so a
  // reopen mid-exit doesn't tear the panel down underneath itself.
  const [mounted, setMounted] = useState(visible);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  useEffect(() => {
    if (visible) setMounted(true);
    Animated.timing(tx, {
      toValue: visible ? 0 : -panelW,
      duration: visible ? 220 : 180,
      useNativeDriver: true,
    }).start(() => {
      if (!visibleRef.current) setMounted(false);
    });
  }, [visible, panelW, tx]);

  // Open ON the page you are reading, not at the top — the entire point of the
  // panel on a long document is that you are a long way from page 1.
  useEffect(() => {
    if (!visible) return undefined;
    const index = showing === 'pages'
      ? Math.max(0, (page || 1) - 1)
      : Math.max(0, (rows || []).findIndex((r) => r.key === activeKey));
    const t = setTimeout(() => {
      // viewPosition 0.3 puts it a third down rather than jammed against the
      // header, so the entries either side of it are visible for context.
      listRef.current?.scrollToIndex?.({ index, animated: false, viewPosition: 0.3 });
    }, 60);
    return () => clearTimeout(t);
  }, [visible, showing, page, rows, activeKey]);

  if (!mounted) return null;

  const chip = (key, label) => {
    const on = showing === key;
    return (
      <Pressable
        onPress={() => { tapHaptic(); onModeChange(key); }}
        accessibilityRole="button"
        accessibilityLabel={`Show ${label.toLowerCase()}`}
        accessibilityState={{ selected: on }}
        style={({ pressed }) => [
          styles.chip,
          { backgroundColor: on ? c.primary : 'transparent', borderColor: on ? c.primary : c.border, opacity: pressed ? 0.6 : 1 },
        ]}
        testID={`pdf-index-mode-${key}`}
      >
        <Text style={[styles.chipText, { color: on ? c.background : c.textPrimary }]} numberOfLines={1}>{label}</Text>
      </Pressable>
    );
  };

  const renderOutlineRow = ({ item }) => {
    const on = item.key === activeKey;
    return (
      <Pressable
        onPress={() => { tapHaptic(); onPick(item.page); }}
        accessibilityRole="button"
        accessibilityLabel={`${item.title}, page ${item.page}`}
        accessibilityState={{ selected: on }}
        style={({ pressed }) => [styles.row, { borderBottomColor: c.border, opacity: pressed ? 0.6 : 1 }]}
        testID={`pdf-toc-${item.key}`}
      >
        <Text
          style={[
            styles.rowTitle,
            {
              color: on ? (c.accentInfo || c.primary) : c.textPrimary,
              // Nesting reads as indentation, capped so a deeply nested entry
              // still has room for its own words.
              paddingLeft: Math.min(item.depth, 4) * 14,
              fontWeight: item.depth === 0 ? '700' : '500',
            },
          ]}
          numberOfLines={2}
        >
          {item.title}
        </Text>
        <Text style={[styles.rowPage, { color: c.textMuted }]} numberOfLines={1}>{item.page}</Text>
      </Pressable>
    );
  };

  const renderPageRow = ({ item }) => {
    const on = item === page;
    return (
      <Pressable
        onPress={() => { tapHaptic(); onPick(item); }}
        accessibilityRole="button"
        accessibilityLabel={`Go to page ${item}`}
        accessibilityState={{ selected: on }}
        style={({ pressed }) => [styles.row, { borderBottomColor: c.border, opacity: pressed ? 0.6 : 1 }]}
        testID={`pdf-page-${item}`}
      >
        <Text style={[styles.rowTitle, { color: on ? (c.accentInfo || c.primary) : c.textPrimary, fontWeight: on ? '700' : '500' }]} numberOfLines={1}>
          {`Page ${item}`}
        </Text>
        {on ? <Icon name="check" size={18} color={c.accentInfo || c.primary} /> : null}
      </Pressable>
    );
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={visible ? 'auto' : 'none'} testID="pdf-index-panel">
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close contents"
        testID="pdf-index-scrim"
      >
        <View style={[StyleSheet.absoluteFill, styles.scrim]} />
      </Pressable>
      <Animated.View
        style={[
          styles.panel,
          {
            width: panelW,
            paddingTop: insets.top + 6,
            backgroundColor: c.surfaceElevated || c.surface,
            borderRightColor: c.border,
            transform: [{ translateX: tx }],
          },
        ]}
      >
        <View style={styles.head}>
          <Text style={[styles.headTitle, { color: c.textPrimary }]} numberOfLines={1}>Contents</Text>
          <Pressable onPress={onClose} onPressIn={tapHaptic} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close contents" style={({ pressed }) => [styles.headBtn, { opacity: pressed ? 0.6 : 1 }]}>
            <Icon name="close" size={22} color={c.textPrimary} />
          </Pressable>
        </View>
        {hasOutline && (
          <View style={styles.chips}>
            {chip('outline', 'Contents')}
            {chip('pages', 'Pages')}
          </View>
        )}
        {showing === 'outline' ? (
          <FlatList
            ref={listRef}
            data={rows}
            keyExtractor={(i) => i.key}
            renderItem={renderOutlineRow}
            getItemLayout={(_, i) => ({ length: ROW_H, offset: ROW_H * i, index: i })}
            // A jump past the end of what's measured would otherwise throw;
            // settle for the top rather than crashing the reader.
            onScrollToIndexFailed={() => {}}
            contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
            keyboardShouldPersistTaps="handled"
          />
        ) : pages.length > 0 ? (
          <FlatList
            ref={listRef}
            data={pages}
            keyExtractor={(i) => String(i)}
            renderItem={renderPageRow}
            getItemLayout={(_, i) => ({ length: ROW_H, offset: ROW_H * i, index: i })}
            onScrollToIndexFailed={() => {}}
            contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
            keyboardShouldPersistTaps="handled"
          />
        ) : (
          <Text style={[styles.empty, { color: c.textMuted }]}>Still counting the pages…</Text>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(0,0,0,0.45)' },
  panel: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRightWidth: StyleSheet.hairlineWidth },
  head: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingLeft: 16, paddingRight: 6 },
  headTitle: { flex: 1, minWidth: 0, fontSize: 16, fontWeight: '700', flexShrink: 1 },
  headBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 10 },
  chip: { minHeight: 32, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 1 },
  chipText: { fontSize: 12.5, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: ROW_H, height: ROW_H, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  rowTitle: { flex: 1, minWidth: 0, fontSize: 14, flexShrink: 1 },
  rowPage: { fontSize: 12.5, fontWeight: '600', flexShrink: 0 },
  empty: { fontSize: 13, textAlign: 'center', paddingVertical: 32, paddingHorizontal: 24 },
});
