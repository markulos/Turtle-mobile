/**
 * DocxViewer — a Word document, read in the app.
 *
 * Mark, 2026-11-17: "can you make the mobile app support opening word files?"
 * Every .docx went to the system share sheet before this, and four files in
 * this repo carried the line "the OS previews a .docx and we cannot".
 *
 * The same shell as PdfViewer — EdgeSwipePage push, the same header, the
 * same Open in… key in the corner — because it is the same errand and a
 * second set of chrome for it would be a second thing to learn. The left-edge
 * swipe back IS kept here, unlike the PDF: there is no pannable surface to
 * take the finger.
 *
 * ── What it shows ────────────────────────────────────────────────────────
 *
 * The text, with its headings, lists and emphasis (utils/docx). NOT a page
 * rendering: no columns, no page breaks, no fonts. That is a deliberate
 * line — this is for READING a document you have been sent, and the Open
 * in… key is one tap away for anything that needs the real layout.
 *
 * Saying so is part of the design rather than an omission to be found out:
 * the footer says "Text view" and offers the real thing beside it.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import EdgeSwipePage from '../EdgeSwipePage';
import { insetRule } from '../../../../utils/surfaceDepth';
import { tapHaptic, notifyHaptic } from '../../../../utils/haptics';
import { useHideDock } from '../../../../context/ChromeContext';
import { ensureLocalCopy, shareDocument } from './documentOpen';
import { messageOf } from './filesUtils';
import { readDocx } from '../../../../utils/docx';
import { SCROLL_INDICATOR } from '../../../../utils/scrollIndicator';

/** Base64 → bytes, because that is what the file system hands back. */
function bytesFrom(base64) {
  // RN has `atob` under Hermes; the manual path is the fallback rather than
  // the rule, so a platform without it still reads the file.
  if (typeof global.atob === 'function') {
    const bin = global.atob(base64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }
  const B = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = String(base64).replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array((clean.length * 3) / 4 | 0);
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B.indexOf(clean[i]) << 18) | (B.indexOf(clean[i + 1]) << 12)
      | ((B.indexOf(clean[i + 2]) & 63) << 6) | (B.indexOf(clean[i + 3]) & 63);
    out[p] = (n >> 16) & 255; p += 1;
    if (clean[i + 2] !== undefined) { out[p] = (n >> 8) & 255; p += 1; }
    if (clean[i + 3] !== undefined) { out[p] = n & 255; p += 1; }
  }
  return out.subarray(0, p);
}

const HEADING_SIZE = { 1: 24, 2: 19, 3: 16.5 };

function Block({ block, theme }) {
  const c = theme.colors;
  if (block.cell) {
    return (
      <Text style={[styles.cell, { color: c.textSecondary, borderLeftColor: c.border }]}>
        {block.text}
      </Text>
    );
  }
  if (block.heading) {
    return (
      <Text style={[styles.heading, { color: c.textPrimary, fontSize: HEADING_SIZE[block.heading] }]}>
        {block.text}
      </Text>
    );
  }
  return (
    <View style={block.listed ? styles.listRow : undefined}>
      {block.listed && <Text style={[styles.bullet, { color: c.textMuted }]}>•</Text>}
      <Text
        style={[
          styles.para,
          { color: c.textPrimary },
          block.bold && styles.bold,
          block.italic && styles.italic,
          block.listed && styles.listText,
        ]}
      >
        {block.text}
      </Text>
    </View>
  );
}

export default function DocxViewer({ visible, item, onClose, getFullUrl, theme }) {
  const c = theme.colors;
  const danger = c.accentError || '#e5484d';
  const insets = useSafeAreaInsets();
  // Reading is a full-screen job, exactly as it is for a PDF.
  useHideDock(visible);

  const [blocks, setBlocks] = useState(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const name = item?.originalName || item?.filename || 'Document';

  useEffect(() => {
    if (!visible || !item) return undefined;
    let alive = true;
    (async () => {
      try {
        const { uri } = await ensureLocalCopy(item, {
          getFullUrl,
          onProgress: (p) => { if (alive && mountedRef.current) setProgress(p); },
        });
        const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
        // Parsing is synchronous and can be a beat on a long document. It is
        // after the await, so the spinner is already up and the frame it
        // costs is one nobody is looking at.
        const parsed = readDocx(bytesFrom(base64));
        if (!alive || !mountedRef.current) return;
        setBlocks(parsed);
      } catch (e) {
        if (!alive || !mountedRef.current) return;
        notifyHaptic('error');
        setError(messageOf(e) || 'This document could not be opened.');
      }
    })();
    return () => { alive = false; };
  }, [visible, item, getFullUrl, attempt]);

  const openInOtherApp = useCallback(async () => {
    try {
      await shareDocument(item, { getFullUrl });
    } catch (e) {
      if (mountedRef.current) setError(messageOf(e) || 'Could not open the file.');
    }
  }, [item, getFullUrl]);

  return (
    <EdgeSwipePage overlay visible={visible} onClose={onClose}>
      <View style={[styles.page, { backgroundColor: c.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
          <Pressable onPress={onClose} onPressIn={tapHaptic} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back" style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.6 : 1 }]}>
            <Icon name="chevron-left" size={28} color={c.textPrimary} />
          </Pressable>
          <Text style={[styles.title, { color: c.textPrimary }]} numberOfLines={1}>{name}</Text>
          <Pressable onPress={openInOtherApp} onPressIn={tapHaptic} hitSlop={10} accessibilityRole="button" accessibilityLabel="Open in another app" style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.6 : 1 }]} testID="docx-share">
            <Icon name="export-variant" size={22} color={c.textPrimary} />
          </Pressable>
        </View>
        <View style={insetRule(theme)} />

        {error ? (
          <View style={styles.centre}>
            <Text style={[styles.errorText, { color: danger }]}>{error}</Text>
            {/* Two ways on, because the two failures are different: the
                download may simply have dropped, and the document may be one
                this reader cannot take. */}
            <Pressable
              onPress={() => { setError(null); setBlocks(null); setProgress(0); setAttempt((n) => n + 1); }}
              onPressIn={tapHaptic}
              accessibilityRole="button"
              accessibilityLabel="Try again"
              style={({ pressed }) => [styles.retry, { backgroundColor: c.surfaceElevated || c.surface, opacity: pressed ? 0.6 : 1 }]}
              testID="docx-retry"
            >
              <Text style={[styles.retryText, { color: c.textPrimary }]}>Try again</Text>
            </Pressable>
            <Pressable onPress={openInOtherApp} onPressIn={tapHaptic} accessibilityRole="button" accessibilityLabel="Open in another app" style={({ pressed }) => [styles.retry, { backgroundColor: 'transparent', opacity: pressed ? 0.6 : 1 }]}>
              <Text style={[styles.retryText, { color: c.textSecondary }]}>Open in…</Text>
            </Pressable>
          </View>
        ) : !blocks ? (
          <View style={styles.centre} testID="docx-loading">
            <ActivityIndicator size="large" color={c.textMuted} />
            {progress > 0 && progress < 1 && (
              <Text style={[styles.progressText, { color: c.textMuted }]}>{`${Math.round(progress * 100)}%`}</Text>
            )}
          </View>
        ) : (
          <ScrollView
            style={styles.body}
            contentContainerStyle={[styles.sheet, { paddingBottom: insets.bottom + 28 }]}
            showsVerticalScrollIndicator
            {...SCROLL_INDICATOR}
            indicatorStyle={theme.mode === 'dark' ? 'white' : 'black'}
            testID="docx-surface"
          >
            {blocks.map((b) => <Block key={b.key} block={b} theme={theme} />)}
            {/* SAID OUT LOUD rather than left to be discovered: this is the
                text, not the page, and the real thing is one tap away. */}
            <View style={[styles.foot, { borderTopColor: c.border }]}>
              <Text style={[styles.footText, { color: c.textMuted }]}>
                Text view — layout, images and fonts are not shown.
              </Text>
              <Pressable onPress={openInOtherApp} onPressIn={tapHaptic} accessibilityRole="button" accessibilityLabel="Open in another app" hitSlop={8}>
                <Text style={[styles.footLink, { color: c.primary || c.textPrimary }]}>Open in…</Text>
              </Pressable>
            </View>
          </ScrollView>
        )}
      </View>
    </EdgeSwipePage>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingBottom: 8, gap: 4 },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  body: { flex: 1 },
  // A READING MEASURE. Full-bleed text on a phone is fine; what it is not is
  // a document, and the inset is most of what makes this feel like one.
  sheet: { paddingHorizontal: 20, paddingTop: 18 },
  heading: { fontWeight: '800', letterSpacing: -0.3, marginTop: 18, marginBottom: 6 },
  para: { fontSize: 15.5, lineHeight: 23, marginBottom: 10 },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  listRow: { flexDirection: 'row', gap: 8, paddingLeft: 4 },
  bullet: { fontSize: 15.5, lineHeight: 23 },
  listText: { flex: 1 },
  // A table's cells, kept in order behind a rule — plainly not prose.
  cell: { fontSize: 14, lineHeight: 21, marginBottom: 8, paddingLeft: 10, borderLeftWidth: 2 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  progressText: { fontSize: 13, fontWeight: '600' },
  errorText: { fontSize: 14.5, textAlign: 'center', lineHeight: 20 },
  retry: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12 },
  retryText: { fontSize: 14, fontWeight: '700' },
  foot: { marginTop: 24, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 10 },
  footText: { flex: 1, fontSize: 11.5, lineHeight: 16 },
  footLink: { fontSize: 12.5, fontWeight: '700' },
});
