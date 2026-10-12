/**
 * The two things a canvas item can be when it is a FILE rather than a photo:
 * a PDF page, drawn, or a card saying which file it is.
 *
 * ─── Why this exists ───────────────────────────────────────────────────────
 *
 * Every media item on a board used to be painted as an <Image> pointed at
 * /api/media/preview/<id>. That endpoint only serves resized variants of
 * IMAGES — a PDF is stored as `type: 'document'` and gets a 400 back ("variant
 * only supported for images") — so a document on a board was an empty bordered
 * rectangle. Not a slow one or a broken-looking one: a blank frame, with
 * nothing to say it was ever a file. That is what "the PDFs don't load" was.
 *
 * ─── A page, not a picture of a page ───────────────────────────────────────
 *
 * The desktop renders the live page through pdfjs. The phone has a renderer
 * too — react-native-pdf, the vault's own reader — so it draws the real page
 * the item is turned to, from the document's own bytes. No new dependency and
 * nothing native to build: it ships over the air.
 *
 * Two rules it keeps, both the desktop's:
 *
 *   · NEVER CROPPED. A photo on this canvas is painted `cover` on purpose —
 *     a moodboard frames pictures, and resizing one is meant to crop. A page
 *     is the opposite: half a page of text is not a smaller page of text, it
 *     is a mistake. So the page is fitted WHOLE inside the item's box.
 *   · The page the board says. `item.page` is set by the desktop's pager and
 *     is the one thing a reader must not get wrong, so a renderer that is
 *     missing or a document that will not parse falls back to the card below
 *     rather than to page one — showing page 1 of a document someone turned
 *     to page 7 is a quiet lie, and a card is not.
 *
 * Unlike the desktop, nothing here reshapes the item to the page's aspect:
 * that is a WRITE, and the phone's canvas is deliberately read-only (see
 * CanvasBoardView's header). The page is letterboxed in the box the desktop
 * gave it instead.
 *
 * ─── Deaf to touch, on purpose ─────────────────────────────────────────────
 *
 * `pointerEvents="none"` over the whole of both, because the stage owns every
 * gesture on this board: it hit-tests taps by arithmetic precisely so that no
 * item needs a handler of its own (a handler on an item fires at the end of a
 * DRAG as readily as a tap). A native PDF view brings its own pan, pinch and
 * page-flick, and letting those compete would mean a board that stops
 * scrolling wherever a document happens to lie.
 */
import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { getPdfModule } from '../../../utils/pdfRenderer';
import { fileBadge, fileIconForName, fileStem } from '../../../utils/fileBadge';

/** react-native-pdf's own fitPolicy: 2 = fit BOTH axes, i.e. the whole page
 *  inside the box. The "never cropped" rule, in one prop. */
const FIT_PAGE = 2;

/**
 * A file with nothing to draw — a .zip, a spreadsheet, a .docx, or a PDF this
 * binary cannot render.
 *
 * The format in large letters and the name underneath. That is what a file on
 * a wall needs to say — which file, and what kind — and it is legible at the
 * size these items are normally placed. Same card the desktop draws.
 */
export function CanvasFileCard({ name, theme, note }) {
  const c = theme.colors;
  const badge = fileBadge(name);
  return (
    <View style={styles.card} pointerEvents="none">
      <Icon name={fileIconForName(name)} size={40} color={c.textTertiary} />
      <Text style={[styles.badge, { color: c.textSecondary }]} numberOfLines={1}>
        {badge}
      </Text>
      <Text style={[styles.name, { color: c.textPrimary }]} numberOfLines={2}>
        {fileStem(name) || 'file'}
      </Text>
      {note ? (
        <Text style={[styles.note, { color: c.textTertiary }]} numberOfLines={1}>{note}</Text>
      ) : null}
    </View>
  );
}

/**
 * The page a board's PDF item is turned to.
 *
 * `singlePage` and no scrolling: this is one page standing in for a document,
 * not a reader — the reader is a tap away (the vault's PdfViewer, which the
 * board routes to). `cache` keeps the downloaded document between boards, and
 * the renderer fetches the URL itself: /api/media/raw is a capability URL and
 * carries no header, which is the same reason the pictures beside it load
 * without the app's fetch interceptor.
 */
export function CanvasPdfPage({ src, page, name, theme }) {
  const Pdf = getPdfModule();
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const c = theme.colors;

  // No renderer in this binary, or this document would not open: say which
  // file it is rather than drawing the wrong page or nothing at all.
  if (!Pdf || failed) {
    return (
      <CanvasFileCard
        name={name}
        theme={theme}
        note={failed ? 'Would not open' : null}
      />
    );
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Pdf
        testID="canvas-pdf-page"
        source={{ uri: src, cache: true }}
        page={page}
        singlePage
        scrollEnabled={false}
        enablePaging={false}
        fitPolicy={FIT_PAGE}
        // A page is ink on paper: it is drawn on white whatever the app's
        // theme is, because a dark-mode page would be a different document.
        style={[StyleSheet.absoluteFill, styles.page]}
        onLoadComplete={() => setReady(true)}
        onError={() => setFailed(true)}
      />
      {/* The renderer paints nothing until the document is parsed, and a wall
          of blank sheets reads as broken. One spinner per sheet, gone the
          moment there is a page under it. */}
      {!ready ? (
        <View style={styles.wait} pointerEvents="none">
          <ActivityIndicator size="small" color={c.textMuted} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    gap: 2,
  },
  badge: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  name: {
    fontSize: 11.5,
    lineHeight: 15,
    textAlign: 'center',
  },
  note: {
    fontSize: 10,
    textAlign: 'center',
  },
  page: {
    backgroundColor: '#fff',
  },
  wait: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
