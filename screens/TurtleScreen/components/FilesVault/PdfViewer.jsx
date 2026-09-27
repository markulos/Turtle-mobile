/**
 * PdfViewer — read a PDF without leaving Turtle.
 *
 * Tapping a document used to mean the system share sheet: Quick Look opens
 * over the app, in Apple's chrome, and backing out of it is a different
 * gesture to every other page in the vault. For the one document type we can
 * actually render ourselves, this is the house page instead — same
 * EdgeSwipePage push, same left-edge swipe back, same header shape as
 * FolderPage — with the controls a reader wants and nothing else.
 *
 * CONTROLS, deliberately few:
 *   · page back / forward, with "4 of 31" between them
 *   · fit width ↔ fit page
 *   · the live zoom, but only once you have zoomed (pinch and double-tap are
 *     the native gestures and need no buttons; a "100%" that never changes is
 *     just noise on the bar)
 *   · Open in … — the old share-sheet path, kept for printing, marking up, or
 *     anything PDFKit won't do
 *
 * The bytes come from ensureLocalCopy, the same cache the share path fills, so
 * a document you have already opened renders straight from disk and works with
 * the pond unreachable.
 *
 * react-native-pdf is required LAZILY and defensively (the pattern
 * systemFilePick.js and MediaGallery's react-native-share use): its native
 * module only exists in a build that bundled it, so a top-level import would
 * take down the runtime on an older binary running this JS as an OTA update.
 * Absent → we fall through to the share sheet, which is exactly where this
 * document used to open anyway.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { insetRule } from '../../../../utils/surfaceDepth';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import EdgeSwipePage from '../EdgeSwipePage';
import { tapHaptic, impactHaptic, notifyHaptic } from '../../../../utils/haptics';
import { useHideDock } from '../../../../context/ChromeContext';
import { ensureLocalCopy, shareDocument } from './documentOpen';
import { messageOf } from './filesUtils';
import PdfIndexPanel from './PdfIndexPanel';
import { flattenOutline } from './pdfOutline';

// 0 = fit width, 2 = fit both (whole page). react-native-pdf's own fitPolicy
// values; named here so the toggle below reads as what it does.
const FIT_WIDTH = 0;
const FIT_PAGE = 2;

let _checked = false;
let _Pdf = null;
const getPdf = () => {
  if (_checked) return _Pdf;
  _checked = true;
  try {
    const mod = require('react-native-pdf');
    _Pdf = mod?.default || mod || null;
  } catch {
    _Pdf = null;
  }
  return _Pdf;
};

/** Tests mount this module more than once with different module state. */
export function __resetPdfModuleForTests() {
  _checked = false;
  _Pdf = null;
}

/** Is there a renderer in this binary? FolderPage asks before routing here. */
export function canRenderPdf() {
  return !!getPdf();
}

function BarKey({ icon, label, onPress, disabled, theme, testID }) {
  const c = theme.colors;
  return (
    <Pressable
      onPress={onPress}
      onPressIn={disabled ? undefined : tapHaptic}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={8}
      style={({ pressed }) => [styles.barKey, { opacity: disabled ? 0.3 : pressed ? 0.6 : 1 }]}
      testID={testID}
    >
      <Icon name={icon} size={22} color={c.textPrimary} />
    </Pressable>
  );
}

export default function PdfViewer({ visible, item, onClose, getFullUrl, theme }) {
  const c = theme.colors;
  const danger = c.accentError || '#e5484d';
  const insets = useSafeAreaInsets();
  const Pdf = getPdf();
  // Reading is a full-screen job: the dock goes while this page is up and
  // comes back when it closes (the hold is released on unmount, so a swipe
  // back returns it as reliably as the chevron does). This is also why the
  // bar below measures off the bare safe area and NOT a tab-bar height —
  // there is no tab bar underneath it any more.
  useHideDock(visible);

  const [uri, setUri] = useState(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [fit, setFit] = useState(FIT_WIDTH);
  const [scale, setScale] = useState(1);
  const pdfRef = useRef(null);
  /**
   * The page we are ASKING the renderer to go to — deliberate jumps only.
   *
   * This is NOT the page you are on. `page` above is that, and feeding it back
   * into the renderer's `page` prop is what made scrolling snap back: every
   * `onPageChanged` re-rendered with a new `page` prop, the native view took
   * that as a fresh instruction and re-anchored the scroll, which reported
   * another page change… a loop that pins the document to whichever page it
   * started the fight on (page 10 of 11, in the report). react-native-pdf's
   * `componentDidUpdate` only watches `source`, so `page` reaches the native
   * side as a raw prop with no guard of its own — the guard has to be here.
   *
   * So: only the page keys and the fit toggle move this. A scroll never does.
   */
  const [jumpTo, setJumpTo] = useState(1);
  // The document's own table of contents, flattened (see pdfOutline.js), plus
  // which list the index panel is showing.
  const [outline, setOutline] = useState([]);
  const [indexOpen, setIndexOpen] = useState(false);
  const [indexMode, setIndexMode] = useState('outline');
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const name = item?.originalName || item?.filename || 'Document';

  // Fetch on OPEN, not on mount: the viewer is mounted by the folder page for
  // whichever row was tapped, and a document swapped underneath it must not
  // keep the previous one's bytes on screen.
  useEffect(() => {
    if (!visible || !item) return undefined;
    let cancelled = false;
    setUri(null);
    setError(null);
    setProgress(0);
    setPage(1);
    setPageCount(0);
    setScale(1);
    setJumpTo(1);
    setOutline([]);
    setIndexOpen(false);
    setIndexMode('outline');
    (async () => {
      try {
        const res = await ensureLocalCopy(item, { getFullUrl, onProgress: (p) => { if (!cancelled) setProgress(p); } });
        if (!cancelled) setUri(res.uri);
      } catch (e) {
        if (!cancelled) { notifyHaptic('error'); setError(messageOf(e)); }
      }
    })();
    return () => { cancelled = true; };
  }, [visible, item, getFullUrl]);

  // A key press IS a deliberate jump, so both halves move: the imperative
  // call (which reaches the native view without a re-render) and `jumpTo`
  // (so a later re-render re-sends the same value rather than an old one).
  // Belt and braces on purpose — when the target happens to equal `jumpTo`
  // already, the prop doesn't change and the ref call is what does the work.
  // The one place a page change is COMMANDED rather than observed. Both the
  // keys and the index panel go through it, so there is a single definition of
  // "move the reader" (and a single place the jumpTo/ref pairing lives).
  const goToPage = useCallback((target) => {
    const next = Math.min(Math.max(1, Math.round(target) || 1), Math.max(1, pageCount || 1));
    if (next === page) return;
    setPage(next);
    setJumpTo(next);
    pdfRef.current?.setPage?.(next);
  }, [page, pageCount]);

  const go = useCallback((delta) => {
    impactHaptic('light');
    goToPage(page + delta);
  }, [page, goToPage]);

  // fitPolicy is consumed once, when the renderer mounts, so the toggle
  // remounts it under a new key and hands back the page you were on. One
  // deliberate tap, one reload from a file already on disk — cheap, and the
  // alternative (no fit control at all) is the thing readers actually miss on
  // a scanned A4 page that arrives too small to read.
  const toggleFit = useCallback(() => {
    impactHaptic('light');
    setJumpTo(page);
    setScale(1);
    setFit((f) => (f === FIT_WIDTH ? FIT_PAGE : FIT_WIDTH));
  }, [page]);

  const openInOtherApp = useCallback(async () => {
    try {
      await shareDocument(item, { getFullUrl });
    } catch (e) {
      notifyHaptic('error');
      setError(messageOf(e));
    }
  }, [item, getFullUrl]);

  const source = useMemo(() => (uri ? { uri, cache: false } : null), [uri]);
  // Only worth saying once it is not 100% — see the header note.
  const zoomLabel = Math.abs(scale - 1) > 0.02 ? `${Math.round(scale * 100)}%` : null;
  const pageLabel = pageCount > 0 ? `${page} of ${pageCount}` : '';

  return (
    // The index panel lives on the left edge, which is also where the page's
    // back-swipe starts — so while it is open the swipe is off, or dragging
    // the drawer would close the whole reader behind it.
    <EdgeSwipePage overlay visible={visible} onClose={onClose} swipeEnabled={!indexOpen}>
      <View style={[styles.page, { backgroundColor: c.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
          <Pressable onPress={onClose} onPressIn={tapHaptic} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back" style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.6 : 1 }]}>
            <Icon name="chevron-left" size={28} color={c.textPrimary} />
          </Pressable>
          <Text style={[styles.title, { color: c.textPrimary }]} numberOfLines={1}>{name}</Text>
          <Pressable onPress={openInOtherApp} onPressIn={tapHaptic} hitSlop={10} accessibilityRole="button" accessibilityLabel="Open in another app" style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.6 : 1 }]} testID="pdf-share">
            <Icon name="export-variant" size={22} color={c.textPrimary} />
          </Pressable>
        </View>
        <View style={insetRule(theme)} />

        <View style={styles.body}>
          {error ? (
            <View style={styles.centre}>
              <Text style={[styles.errorText, { color: danger }]}>{error}</Text>
              <Pressable
                onPress={() => { setError(null); setUri(null); setProgress(0); setPage(1); }}
                onPressIn={tapHaptic}
                accessibilityRole="button"
                accessibilityLabel="Try again"
                style={({ pressed }) => [styles.retry, { backgroundColor: c.surfaceElevated || c.surface, opacity: pressed ? 0.6 : 1 }]}
              >
                <Text style={[styles.retryText, { color: c.textPrimary }]}>Try again</Text>
              </Pressable>
            </View>
          ) : !Pdf ? (
            // No renderer in this binary. Say so plainly and offer the path
            // this document opened by before the viewer existed.
            <View style={styles.centre}>
              <Text style={[styles.errorText, { color: c.textSecondary }]}>The built-in reader arrives with the next app build.</Text>
              <Pressable onPress={openInOtherApp} onPressIn={tapHaptic} accessibilityRole="button" accessibilityLabel="Open in another app" style={({ pressed }) => [styles.retry, { backgroundColor: c.surfaceElevated || c.surface, opacity: pressed ? 0.6 : 1 }]}>
                <Text style={[styles.retryText, { color: c.textPrimary }]}>Open in…</Text>
              </Pressable>
            </View>
          ) : !source ? (
            <View style={styles.centre}>
              <ActivityIndicator size="large" color={c.textMuted} />
              {progress > 0 && progress < 1 && (
                <Text style={[styles.progressText, { color: c.textMuted }]}>{`${Math.round(progress * 100)}%`}</Text>
              )}
            </View>
          ) : (
            <Pdf
              // Remount on a fit change so the new fitPolicy is picked up; the
              // page below puts the reader back where they were.
              key={`fit-${fit}`}
              ref={pdfRef}
              source={source}
              page={jumpTo}
              fitPolicy={fit}
              spacing={8}
              minScale={1}
              maxScale={4}
              enablePaging={false}
              enableDoubleTapZoom
              enableAntialiasing
              trustAllCerts={false}
              onLoadComplete={(n, _path, _size, tableContents) => {
                if (!mountedRef.current) return;
                const total = Number(n) || 0;
                setPageCount(total);
                const rows = flattenOutline(tableContents, { pageCount: total });
                setOutline(rows);
                // A document with no contents opens the panel on its page list
                // rather than on an empty "Contents" nobody asked for.
                if (rows.length === 0) setIndexMode('pages');
              }}
              // The label follows the document. `jumpTo` deliberately does
              // NOT — see the note on it; echoing a scroll back as a `page`
              // prop is the snap-back bug.
              onPageChanged={(p, n) => {
                if (!mountedRef.current) return;
                setPage(Number(p) || 1);
                if (n) setPageCount(Number(n) || 0);
              }}
              onScaleChanged={(s) => { if (mountedRef.current) setScale(Number(s) || 1); }}
              onError={(e) => { if (mountedRef.current) { notifyHaptic('error'); setError(messageOf(e) || 'This PDF could not be opened.'); } }}
              style={[styles.pdf, { backgroundColor: c.background }]}
              testID="pdf-surface"
            />
          )}
        </View>

        {!error && !!Pdf && !!source && (
          <View style={[styles.bar, { backgroundColor: c.surfaceElevated || c.surface, borderTopColor: c.border, paddingBottom: insets.bottom + 8 }]}>
            <BarKey icon="chevron-left" label="Previous page" onPress={() => go(-1)} disabled={page <= 1} theme={theme} testID="pdf-prev" />
            <Text style={[styles.pageLabel, { color: c.textPrimary }]} numberOfLines={1} testID="pdf-page-label">{pageLabel}</Text>
            <BarKey icon="chevron-right" label="Next page" onPress={() => go(1)} disabled={pageCount > 0 && page >= pageCount} theme={theme} testID="pdf-next" />
            {/* Between the page keys and the fit key, because it is the third
                way to move through the document and belongs with the other
                two rather than off in the header with Open in…. */}
            <BarKey
              icon="format-list-numbered"
              label="Contents and pages"
              onPress={() => { impactHaptic('light'); setIndexOpen(true); }}
              disabled={pageCount <= 0}
              theme={theme}
              testID="pdf-index"
            />
            <View style={styles.barSpacer} />
            {!!zoomLabel && <Text style={[styles.zoomLabel, { color: c.textMuted }]} numberOfLines={1} testID="pdf-zoom-label">{zoomLabel}</Text>}
            <BarKey
              icon={fit === FIT_WIDTH ? 'fit-to-page-outline' : 'arrow-expand-horizontal'}
              label={fit === FIT_WIDTH ? 'Fit whole page' : 'Fit width'}
              onPress={toggleFit}
              theme={theme}
              testID="pdf-fit"
            />
          </View>
        )}

        <PdfIndexPanel
          visible={indexOpen}
          rows={outline}
          pageCount={pageCount}
          page={page}
          mode={indexMode}
          onModeChange={setIndexMode}
          onPick={(p) => { setIndexOpen(false); goToPage(p); }}
          onClose={() => setIndexOpen(false)}
          theme={theme}
        />
      </View>
    </EdgeSwipePage>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  // The bottom edge comes from `insetRule` at the call site (STYLE-RULES §1).
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingBottom: 8, minHeight: 44 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '700', flexShrink: 1, textAlign: 'center' },
  body: { flex: 1 },
  pdf: { flex: 1, width: '100%' },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 14 },
  errorText: { fontSize: 15, lineHeight: 21, textAlign: 'center' },
  progressText: { fontSize: 13 },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 18, borderRadius: 22 },
  retryText: { fontSize: 15, fontWeight: '700' },
  bar: { flexDirection: 'row', alignItems: 'center', paddingTop: 8, paddingHorizontal: 12, borderTopWidth: StyleSheet.hairlineWidth, gap: 4 },
  barKey: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  // Sized to the widest label it takes ("100 of 100") so the keys either side
  // don't shuffle sideways as the page number grows.
  pageLabel: { fontSize: 13.5, fontWeight: '700', minWidth: 74, textAlign: 'center', flexShrink: 1 },
  barSpacer: { flex: 1 },
  zoomLabel: { fontSize: 12, fontWeight: '600', flexShrink: 1, marginRight: 2 },
});
