/**
 * ImageEditor — the viewer's pencil key. Three tools: rotate a quarter turn,
 * draw on the photo, and cut a sticker out of it.
 *
 * Rendered as an IN-TREE absolute overlay, deliberately NOT a <Modal> — same
 * reason AlbumActionsSheet gives: the vault can itself sit inside one (the
 * chat's vault overlay), and on iOS a second sibling Modal over an open one
 * silently never appears.
 *
 * WHICH TREE IT HAS TO BE IN. Because it is in-tree, it can only ever draw
 * over its own siblings — no zIndex crosses a native Modal's window boundary.
 * The editor is opened from the viewer's pencil, and the viewer IS a Modal, so
 * mounting this at the gallery's screen root put it UNDERNEATH the very thing
 * it edits. It belongs inside PhotoViewer's children, with the share chooser
 * and the "preparing" card, and it carries a zIndex (plus the matching Android
 * elevation) above all of them: while the editor is up it is the whole screen.
 *
 * Chrome is fixed dark rather than themed, matching ViewerChrome. An editor
 * that sits on top of a photograph has to be neutral around it, and a light
 * theme's surface would wash out the very thing being edited.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ONE TOOL AT A TIME, AND WHY
 *
 * The three tools are modes, not a palette you combine. Rotate is free and
 * instant because it's a `transform` on the preview and metadata on the pond;
 * drawing is a path in the photo's own coordinates. Allowing both at once would
 * mean normalizing a finger against a rect that is also rotated — the arithmetic
 * is doable, the bugs are invisible (strokes land mirrored on two of the four
 * angles), and nobody rotates and draws in the same gesture. So switching tools
 * discards the other tool's unsaved state, which costs nothing: NOTHING is
 * written until Save, so a discarded preview is a discarded preview.
 *
 * WHERE THE WORK HAPPENS. Still the pond, for all three. Rotate stores an angle
 * (lossless, and four turns land on the byte-identical original). Markup and
 * cutout genuinely have to re-encode, so they can't be stored as metadata — and
 * because they can't, they DON'T TOUCH THE ORIGINAL: each one files a brand new
 * vault item and leaves the photo it came from alone. That's the pond's call
 * (see createDerivedPhotoHandler) but it's the reason this screen can offer a
 * destructive-sounding tool without a confirmation step.
 *
 * The phone sends coordinates, never pixels: a 25 MB HEIC is drawn on at full
 * resolution by sharp without the phone ever decoding it. See
 * imageEditorGeometry.js for the coordinate contract.
 *
 * WHICH DIMENSIONS THE COORDINATES ARE A FRACTION OF — the thing that was
 * wrong. They are a fraction of the photo AS DECODED, measured from the
 * <Image>'s own onLoad, NOT of `item.width`/`item.height`. The row's columns
 * are null for every tunnel-stored photo on this pond and carry pre-EXIF
 * dimensions elsewhere, and with nothing to go on `fitRect` returns the whole
 * stage — so a trace was being sent as a fraction of the letterboxed stage and
 * cut out as a fraction of the photo. See `natural` below.
 *
 * The fit trick (rotate): for a quarter turn the frame's width/height are
 * SWAPPED before the rotation is applied, so the rotated result lands exactly
 * inside the measured stage instead of overflowing it. `contentFit="contain"`
 * then letters the photo into that swapped frame, which is what a person
 * turning a photo expects to see.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import Svg, { Circle, Path } from 'react-native-svg';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { impactHaptic, notifyHaptic, tapHaptic } from '../../../utils/haptics';
import { rotationOf, withRotation } from '../../../utils/mediaRotation';
import {
  MAX_STROKES,
  appendPoint,
  fitRect,
  isOutsidePhoto,
  isUsableOutline,
  svgPathIn,
  toPhotoPoint,
  widthFraction,
} from './imageEditorGeometry';

/** Where the rotated frame's long edge goes — see the fit trick above. */
const isQuarterTurn = (deg) => deg % 180 !== 0;

export const TOOLS = ['rotate', 'draw', 'sticker'];

/**
 * The pen's palette. A fixed list, not a colour wheel: six colours cover
 * annotating a photo (point at it, circle it, scribble over it) and a fixed list
 * is also what lets the pond accept colours by regex rather than by trust.
 *
 * White and black first because they're what a photo needs most often — one of
 * the two always contrasts — and red third because it's what everyone reaches
 * for when pointing at something.
 */
const PEN_COLORS = ['#ffffff', '#111111', '#ff3b30', '#ffcc00', '#34c759', '#0a84ff'];

/** On-screen pen widths, in stage pixels. Converted to a fraction on save. */
const PEN_SIZES = [3, 6, 12];

/**
 * How alike a pixel has to be to the one you tapped for the wand to take it.
 *
 * Three named steps rather than a slider: the useful range is narrow, the
 * difference between 0.11 and 0.13 is not something anyone can aim at, and a
 * tap-retap-retap loop through three choices is faster than dragging a control
 * and waiting for a round trip after each nudge.
 */
const WAND_TOLERANCES = [
  { key: 'tight', label: 'Tight', value: 0.07 },
  { key: 'normal', label: 'Normal', value: 0.13 },
  { key: 'loose', label: 'Loose', value: 0.22 },
];

/**
 * Dropped points closer than this (in stage pixels) to the last kept one. A
 * move event per frame is thousands of sub-pixel points otherwise.
 */
const MIN_STEP_PX = 2;

/**
 * A sentence a person can act on, out of whatever the api client threw.
 *
 * ServerContext's apiPost rejects non-2xx with `API Error 400: {"success":
 * false,"message":"…"}` — the status and the raw JSON body glued into one
 * string. Shown as-is that's the worst kind of error message, so dig the
 * server's own `message`/`error` out of it when it's there.
 */
function humanError(e, fallback = 'Could not save this photo.') {
  const raw = (e && e.message) || '';
  const brace = raw.indexOf('{');
  if (brace >= 0) {
    try {
      const body = JSON.parse(raw.slice(brace));
      if (body.message || body.error) return body.message || body.error;
    } catch { /* not JSON after all — fall through to the raw text */ }
  }
  return raw || fallback;
}

export default function ImageEditor({
  visible,
  item,
  api,
  getFullUrl,
  colors,
  insets = { top: 0, bottom: 0 },
  bottomInset = 0,
  onClose,
  onSaved,
  onCreated,
  onError,
}) {
  const [tool, setTool] = useState('rotate');
  // Quarter turns the user has added IN THIS SESSION of the editor, 0–3. Kept
  // separate from the item's stored angle so Cancel is a no-op by construction
  // and Save can send a single relative delta.
  const [turns, setTurns] = useState(0);
  const [saving, setSaving] = useState(false);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  /**
   * The DECODED size of the photo on screen, from the <Image>'s own onLoad.
   *
   * THIS IS THE GROUND TRUTH AND THE ROW'S `width`/`height` ARE NOT. Two
   * reasons, and the second one is most of this pond:
   *
   *   · The pond bakes EXIF orientation into every render it serves
   *     (services/imageRotation.js `openRotated` — a bare `.rotate()` first,
   *     always). So a portrait phone photo DECODES portrait while a row that
   *     recorded raw sensor dimensions says landscape.
   *   · A tunnel-stored row may never have been probed at all, and carries
   *     `width: null, height: null`. On this pond that is the common case, not
   *     the exotic one: every photo in the library sampled on 2026-10-02 had
   *     both columns null.
   *
   * With no dimensions `fitRect` falls back to the whole stage, and the
   * fallback's own comment claims the result is "at worst uniformly stretched,
   * never offset". That reasoning is wrong, and it is the bug: the fractions go
   * to the pond, which multiplies them by the PHOTO's pixels, so a fraction of
   * the letterboxed STAGE lands both offset AND stretched. A trace around
   * someone's head cuts out a rectangle of sky next to them.
   *
   * Measuring removes the whole class: onLoad reports what was actually
   * decoded, EXIF and all, with nothing to keep in sync and no backfill.
   */
  const [natural, setNatural] = useState(null);

  // Finished strokes, and the one the finger is still drawing. Separate so a
  // move only re-renders the live path, not the whole scribble.
  const [strokes, setStrokes] = useState([]);
  const [live, setLive] = useState(null);
  const [penColor, setPenColor] = useState(PEN_COLORS[0]);
  const [penSize, setPenSize] = useState(PEN_SIZES[1]);
  // The lasso: one open path, closed by the pond on save.
  const [outline, setOutline] = useState([]);
  /**
   * The WAND: tap instead of trace, and the pond works out the edge.
   *
   * It answers in the same normalized outline a finger produces, so everything
   * downstream — the dashed preview, Clear, Save, the pond's /sticker route —
   * is untouched. The only new state is which mode the sticker tool is in and
   * how fussy the match should be.
   *
   * It has to be the pond: a wand needs PIXELS, and react-native has no pixel
   * API. The libraries that would give it one are native modules, which means
   * a new runtime fingerprint and a TestFlight build before a single phone
   * could use it — while the pond already decodes these photos for every
   * sticker it cuts. See server services/imageWand.js.
   */
  const [wand, setWand] = useState(false);
  const [tolerance, setTolerance] = useState(WAND_TOLERANCES[1].value);
  const [wanding, setWanding] = useState(false);

  /**
   * THE GESTURE'S OWN STATE LIVES IN THESE REFS; the state above mirrors them
   * for rendering. Two reasons, both of which bit the first version of this:
   *   • PanResponder is built ONCE (rebuilding it mid-gesture drops the
   *     gesture), so its handlers close over the first render's values and have
   *     to read everything current through a ref.
   *   • A stroke is committed on release. Doing that from inside a setState
   *     updater makes the updater impure — React is free to call it twice, and
   *     would then file the stroke twice. Writing the ref synchronously and
   *     calling setState with the result keeps both honest.
   */
  const liveRef = useRef(null);
  const outlineRef = useRef([]);
  // Whether the finger that is down STARTED a valid stroke (on the photo, not
  // in the letterbox). Coordinates no longer live here — see touchPoint.
  const tracking = useRef(null);
  const drawRef = useRef({});

  const stored = rotationOf(item);
  const dirtyTurns = turns % 4 !== 0;
  const drawn = strokes.length > 0 || (live?.points?.length > 0);
  const traced = isUsableOutline(outline);
  const dirty = tool === 'rotate' ? dirtyTurns : (tool === 'draw' ? drawn : traced);

  /**
   * Discard everything unsaved. Used by both the reopen effect and the tool
   * switcher, and it clears the gesture REFS as well as the state they mirror —
   * a live stroke left in a ref would be committed by the next release and land
   * on the next photo.
   */
  const discardEdits = useCallback(() => {
    setTurns(0);
    // The wand is a MODE of the sticker tool, so it goes back to tracing when
    // the tool changes or the editor is pointed at another photo.
    setWand(false);
    setStrokes([]);
    setLive(null);
    setOutline([]);
    liveRef.current = null;
    outlineRef.current = [];
    tracking.current = null;
  }, []);

  // Reopening on a different photo (or the same one after a save) must not
  // inherit the last session's work.
  useEffect(() => {
    if (!visible) return;
    setTool('rotate');
    setSaving(false);
    discardEdits();
  }, [visible, item?.id, discardEdits]);

  // The photo as it currently IS — the display tier at its stored angle, so
  // the editor opens showing exactly what the viewer was showing.
  const uri = useMemo(() => {
    if (!item?.id || typeof getFullUrl !== 'function') return null;
    return withRotation(getFullUrl(`/api/media/display/${item.id}`), stored);
  }, [item?.id, getFullUrl, stored]);

  const onStageLayout = useCallback((e) => {
    const { width, height } = e.nativeEvent.layout;
    setStage((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }));
  }, []);

  /**
   * The photo's size, measured if we have it and taken from the row if not.
   *
   * The row is the FALLBACK now, not the source — see `natural` above. It is
   * still worth having: it is right for most ponds, and it lets the surface arm
   * on the first frame instead of after a decode.
   */
  const source = useMemo(() => {
    if (natural) return natural;
    const w = Number(item?.width) || 0;
    const h = Number(item?.height) || 0;
    return w > 0 && h > 0 ? { w, h } : null;
  }, [natural, item?.width, item?.height]);

  // Where the photo is actually drawn inside the stage. Everything a finger
  // does is measured against THIS, not the stage — see imageEditorGeometry.
  const rect = useMemo(() => fitRect(stage, source), [stage, source]);

  /**
   * Is the geometry trustworthy enough to draw against?
   *
   * `fitRect` answers with the whole stage when it is given nothing, and that
   * answer is unusable here (it is the bug described on `natural`). So the
   * drawing surface does not arm until the photo's real proportions are known
   * — a tool that waits a beat for the decode is better than one that silently
   * cuts the wrong part of the picture.
   */
  const ready = !!source && rect.w > 0 && rect.h > 0;

  /** Reset the measurement when the editor is pointed at a different photo. */
  useEffect(() => { setNatural(null); }, [item?.id, visible]);

  const onImageLoad = useCallback((e) => {
    const s = e?.source;
    const w = Number(s?.width) || 0;
    const h = Number(s?.height) || 0;
    if (w <= 0 || h <= 0) return;
    setNatural((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
  }, []);

  // Refreshed every render, so the once-built PanResponder always reads the
  // tool, the rect and the pen as they are NOW.
  drawRef.current = { tool, rect, penColor, penSize, saving, strokeCount: strokes.length, wand };
  // The wand's own inputs, read by a callback that is built once.
  const wandRef = useRef({});
  wandRef.current = { api, itemId: item?.id, tolerance, wanding };

  /**
   * Where the finger is, in stage space.
   *
   * `locationX/Y` is dependable on the GRANT — but ONLY because the preview
   * layer above is wrapped in a `pointerEvents="none"` View (see the render);
   * without that wrapper the <Svg> is the touch target and every reading is
   * short by the letterbox. During a drag Android reports locationX against
   * whatever view happens to be under the finger, which silently warps any
   * stroke that passes over another view. So the origin is taken once at grant,
   * and every later point is that origin plus the finger's travel in PAGE
   * space — the screen's own coordinate system, which means the same thing on
   * both platforms for the whole gesture.
   */
  const touchPoint = useCallback((e) => {
    const origin = tracking.current;
    const native = e?.nativeEvent;
    if (!origin || !native) return null;
    const pageX = Number(native.pageX);
    const pageY = Number(native.pageY);
    if (!Number.isFinite(pageX) || !Number.isFinite(pageY)) return null;
    return { x: origin.x + (pageX - origin.pageX), y: origin.y + (pageY - origin.pageY) };
  }, []);

  /**
   * A tap in wand mode: ask the pond what is under it.
   *
   * The answer REPLACES the outline, exactly as a second trace does — two
   * selections cannot be combined into one cutout, and the alternative
   * (silently keeping the first while showing the second) is the worse of the
   * two surprises.
   */
  const castWand = useCallback(async (point) => {
    const { api: client, itemId } = wandRef.current;
    if (!client || !itemId) return;
    setWanding(true);
    try {
      const res = await client.post(`/media/${itemId}/wand`, {
        seed: point,
        tolerance: wandRef.current.tolerance,
      });
      const next = Array.isArray(res?.outline) ? res.outline : null;
      if (!next || next.length < 3) throw new Error('Could not find an edge there.');
      notifyHaptic();
      outlineRef.current = next;
      setOutline(next);
    } catch (e) {
      // An older pond has no /wand route at all, and says so as a 404 — which
      // is a different sentence from "that selected the whole photo".
      const raw = (e && e.message) || '';
      onError?.(
        /\b404\b|not found/i.test(raw)
          ? 'This pond does not have the wand yet — it needs an update.'
          : humanError(e, 'Could not work out a selection there.'),
        'sticker',
      );
    } finally {
      setWanding(false);
    }
  }, [onError]);

  const beginStroke = useCallback((e) => {
    const { tool: t, rect: r, saving: busy, strokeCount, wand: isWand } = drawRef.current;
    if (busy || (t !== 'draw' && t !== 'sticker')) return;
    // In wand mode the surface takes TAPS, not traces: the point is the seed.
    if (t === 'sticker' && isWand) {
      const native = e?.nativeEvent || {};
      const at = { x: native.locationX, y: native.locationY };
      if (isOutsidePhoto(at, r)) { tracking.current = null; return; }
      const seed = toPhotoPoint(at, r);
      tracking.current = null;
      if (!seed || wandRef.current.wanding) return;
      impactHaptic();
      void castWand(seed);
      return;
    }
    const native = e?.nativeEvent || {};
    const touch = { x: native.locationX, y: native.locationY };
    // A finger-down in the letterbox was never aimed at the photo; starting a
    // stroke there would stamp a clamped mark on the nearest edge.
    if (isOutsidePhoto(touch, r)) { tracking.current = null; return; }
    const point = toPhotoPoint(touch, r);
    if (!point) { tracking.current = null; return; }
    tracking.current = {
      ...touch,
      pageX: Number(native.pageX) || 0,
      pageY: Number(native.pageY) || 0,
    };
    if (t === 'sticker') {
      // A new trace replaces the old one. Two lassos can't be combined into one
      // cutout, and silently keeping the first while showing the second is the
      // worse of the two surprises.
      impactHaptic();
      outlineRef.current = [point];
      setOutline(outlineRef.current);
      return;
    }
    if (strokeCount >= MAX_STROKES) { tracking.current = null; return; }
    liveRef.current = { color: drawRef.current.penColor, size: drawRef.current.penSize, points: [point] };
    setLive(liveRef.current);
  }, []);

  const extendStroke = useCallback((e) => {
    const { tool: t, rect: r } = drawRef.current;
    const touch = touchPoint(e);
    if (!touch) return;
    const point = toPhotoPoint(touch, r);
    if (!point) return;
    const minStep = MIN_STEP_PX / (r.w || 1);
    if (t === 'sticker') {
      const next = appendPoint(outlineRef.current, point, minStep);
      if (next === outlineRef.current) return;
      outlineRef.current = next;
      setOutline(next);
      return;
    }
    const current = liveRef.current;
    if (!current) return;
    const points = appendPoint(current.points, point, minStep);
    if (points === current.points) return;
    liveRef.current = { ...current, points };
    setLive(liveRef.current);
  }, [touchPoint]);

  const endStroke = useCallback(() => {
    tracking.current = null;
    if (drawRef.current.tool === 'sticker') return;
    const finished = liveRef.current;
    liveRef.current = null;
    if (!finished) return;
    setStrokes((all) => (all.length >= MAX_STROKES ? all : [...all, finished]));
    setLive(null);
  }, []);

  /**
   * The raw responder props, NOT PanResponder.
   *
   * PanResponder's entire added value is `gestureState` — accumulated dx/dy,
   * velocity, multi-touch centroids — and a drawing surface wants none of it: a
   * stroke is the list of places the finger WAS, which is the raw page
   * coordinates, one event at a time. Wrapping those in a gesture recognizer
   * only adds a layer that smooths and summarizes exactly the data being kept.
   */
  const responder = useMemo(() => ({
    // Claimed on the START, not on a move: a dot (a tap) is a legitimate mark,
    // and waiting for movement would also let the first few pixels of a stroke
    // reach the viewer's pan gesture underneath.
    onStartShouldSetResponder: () => {
      const { tool: t, saving: busy } = drawRef.current;
      return !busy && (t === 'draw' || t === 'sticker');
    },
    onMoveShouldSetResponder: () => {
      const { tool: t, saving: busy } = drawRef.current;
      return !busy && (t === 'draw' || t === 'sticker');
    },
    // Nothing above may steal a stroke in progress — the viewer's dismiss-swipe
    // lives directly underneath and would take the whole editor with it.
    onResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onResponderGrant: (e) => beginStroke(e),
    onResponderMove: (e) => extendStroke(e),
    onResponderRelease: () => endStroke(),
    // A terminated gesture (a call, the app backgrounding) still ends the
    // stroke, otherwise the next touch continues a line from minutes ago.
    onResponderTerminate: () => endStroke(),
  }), [beginStroke, extendStroke, endStroke]);

  const selectTool = useCallback((next) => {
    if (saving || next === tool) return;
    tapHaptic();
    // Switching discards the other tool's preview — see the header comment.
    setTool(next);
    discardEdits();
  }, [saving, tool, discardEdits]);

  const rotate = useCallback(() => {
    if (saving) return;
    impactHaptic();
    setTurns((t) => (t + 1) % 4);
  }, [saving]);

  const undo = useCallback(() => {
    if (saving) return;
    tapHaptic();
    if (tool === 'sticker') {
      outlineRef.current = [];
      setOutline([]);
      return;
    }
    liveRef.current = null;
    setLive(null);
    setStrokes((all) => all.slice(0, -1));
  }, [saving, tool]);

  const cancel = useCallback(() => {
    if (saving) return;
    tapHaptic();
    onClose?.();
  }, [saving, onClose]);

  const save = useCallback(async () => {
    if (saving) return;
    // Nothing moved — closing is the whole correct behaviour. Posting an empty
    // edit would still make the pond re-render tiers, or file an empty copy.
    if (!dirty) { tapHaptic(); onClose?.(); return; }
    setSaving(true);
    try {
      if (tool === 'rotate') {
        const res = await api.post(`/media/${item.id}/rotate`, { degrees: (turns % 4) * 90 });
        if (!res?.success) throw new Error(res?.message || res?.error || 'Rotate failed');
        notifyHaptic();
        // Hand back the server's own view of the row. The angle, the swapped
        // width/height, the fresh thumbnail URLs and the now-null compressedUrl
        // all have to land together or the grid renders the new thumbnail in the
        // old aspect.
        onSaved?.({
          rotation: res.rotation,
          width: res.width,
          height: res.height,
          thumbnailUrl: res.thumbnailUrl,
          thumbnailLgUrl: res.thumbnailLgUrl,
          blurhash: res.blurhash,
          compressedUrl: res.compressedUrl ?? null,
        });
        onClose?.();
        return;
      }

      if (tool === 'draw') {
        // The live stroke counts: a finger still down when Save is tapped is
        // impossible, but a stroke that ended in the same frame is not.
        const all = live ? [...strokes, live] : strokes;
        const res = await api.post(`/media/${item.id}/markup`, {
          strokes: all.map((s) => ({
            color: s.color,
            width: widthFraction(s.size, rect),
            points: s.points,
          })),
        });
        if (!res?.success) throw new Error(res?.message || res?.error || 'Markup failed');
        notifyHaptic();
        // A NEW item, not a patch: the original is untouched, so the caller has
        // to add the copy to the grid rather than mutate a row in it.
        onCreated?.(res.item, { kind: 'markup' });
        onClose?.();
        return;
      }

      const res = await api.post(`/media/${item.id}/sticker`, { outline });
      if (!res?.success) throw new Error(res?.message || res?.error || 'Sticker failed');
      notifyHaptic();
      onCreated?.(res.item, { kind: 'sticker' });
      onClose?.();
    } catch (e) {
      // Stay OPEN on failure, with the drawing still applied, so the user can
      // retry without doing the work again.
      setSaving(false);
      onError?.(humanError(e), tool);
    }
  }, [
    saving, dirty, tool, api, item?.id, turns, strokes, live, outline, rect,
    onSaved, onCreated, onClose, onError,
  ]);

  if (!visible || !item) return null;

  // Swap the frame for a quarter turn so the rotated photo fits the stage.
  const frame = isQuarterTurn(turns * 90)
    ? { width: stage.h, height: stage.w }
    : { width: stage.w, height: stage.h };
  const tint = colors?.primary || '#3b82f6';
  const drawing = tool === 'draw' || tool === 'sticker';
  const canUndo = tool === 'sticker' ? outline.length > 0 : drawn;
  const title = tool === 'draw' ? 'Draw' : tool === 'sticker' ? 'Make a sticker' : 'Edit photo';
  // Say so while the surface is disarmed, rather than letting a finger find
  // out by drawing nothing.
  const hint = drawing && !ready
    ? 'Loading the photo…'
    : tool === 'sticker'
      ? (wand ? 'Tap what you want to keep.' : 'Trace around what you want to keep.')
      : tool === 'draw' ? 'Draw on the photo with your finger.' : null;

  const liveAll = live ? [...strokes, live] : strokes;

  return (
    // Claims the touch at the root so nothing lands on the viewer underneath:
    // an in-tree overlay made of plain Views lets a finger through to the
    // stage's gestures, and a swipe meant for the editor would dismiss the
    // viewer — and this editor with it — mid-edit. A responder claim rather
    // than a Pressable: the children keep theirs (the deepest claim wins), and
    // the editor doesn't become one giant button to a screen reader.
    <View
      style={styles.root}
      onStartShouldSetResponder={() => true}
      testID="image-editor"
    >
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {!!hint && <Text style={styles.hint} numberOfLines={1}>{hint}</Text>}
      </View>

      <View style={styles.stage} onLayout={onStageLayout} testID="image-editor-stage">
        {stage.w > 0 && !!uri && (
          <Image
            source={{ uri }}
            style={[frame, { transform: [{ rotate: `${turns * 90}deg` }] }]}
            contentFit="contain"
            transition={0}
            cachePolicy="memory-disk"
            placeholder={item.blurhash ? { blurhash: item.blurhash } : null}
            // What the photo ACTUALLY is, as decoded. See `natural`.
            onLoad={onImageLoad}
            testID="image-editor-preview"
          />
        )}

        {/* The drawing surface covers the whole STAGE, while the ink is drawn
            only over the photo's rect inside it.

            It has to be the stage: `locationX` is measured against the view that
            was touched, so a surface the size of the photo could never tell a
            finger-down in the letterbox from one on the photo's edge — it would
            report both as the edge. Covering the stage means the letterbox is
            inside the same coordinate space, which is what makes
            isOutsidePhoto's answer meaningful. When the tool isn't a drawing one
            the surface isn't mounted at all, so rotate keeps its own taps. */}
        {drawing && ready && (
          <View
            style={styles.surface}
            testID="image-editor-surface"
            {...responder}
          >
            {/* THE WRAPPER IS LOAD-BEARING, NOT TIDINESS.
                `pointerEvents="none"` on the <Svg> itself does NOTHING:
                react-native-svg builds its native props from an extracted list
                that has no `pointerEvents` in it, so the prop is dropped and the
                SVG view stays hit-testable. The moment a trace had drawn
                anything, the Svg — which covers exactly the photo's rect —
                became the touch target, and `locationX/locationY` arrived
                relative to IT rather than to the surface. Short by the
                letterbox: on a 4:3 photo in a tall stage, about 190 points of
                pure vertical offset between the finger and the line following
                it. A plain View DOES honour the prop, for itself and its whole
                subtree, which puts the touch target back on the surface where
                every coordinate in this file assumes it is. */}
            <View
              pointerEvents="none"
              style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
              testID="image-editor-preview-layer"
            >
            <Svg
              width={rect.w}
              height={rect.h}
              pointerEvents="none"
            >
              {tool === 'draw' && liveAll.map((s, i) => (
                s.points.length < 2 ? (
                  <Circle
                    key={`dot-${i}`}
                    cx={s.points[0][0] * rect.w}
                    cy={s.points[0][1] * rect.h}
                    r={s.size / 2}
                    fill={s.color}
                  />
                ) : (
                  <Path
                    key={`stroke-${i}`}
                    d={svgPathIn(s.points, rect)}
                    stroke={s.color}
                    strokeWidth={s.size}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                )
              ))}
              {tool === 'sticker' && outline.length >= 2 && (
                <Path
                  // Closed in the preview even though the finger hasn't closed
                  // it, because the pond closes it on save — the preview's whole
                  // job is to show what will be cut.
                  d={svgPathIn(outline, rect, { close: true })}
                  stroke="#ffffff"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  fill="rgba(255,255,255,0.18)"
                  testID="image-editor-lasso"
                />
              )}
            </Svg>
            </View>
          </View>
        )}

        {(saving || wanding) && (
          <View style={styles.savingVeil} pointerEvents="none">
            <ActivityIndicator size="large" color="#fff" />
          </View>
        )}
      </View>

      <View style={[styles.tools, { paddingBottom: bottomInset + 14 }]}>
        {/* The pen's own controls, above the tool row so the thing being
            configured is nearer the photo than the thing being chosen. */}
        {tool === 'draw' && (
          <View style={styles.penRow}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.swatches}
            >
              {PEN_COLORS.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => { tapHaptic(); setPenColor(c); }}
                  disabled={saving}
                  style={[
                    styles.swatch,
                    { backgroundColor: c },
                    penColor === c && styles.swatchOn,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Pen colour ${c}`}
                  accessibilityState={{ selected: penColor === c }}
                  testID={`image-editor-color-${c}`}
                />
              ))}
            </ScrollView>
            <View style={styles.sizes}>
              {PEN_SIZES.map((s) => (
                <Pressable
                  key={s}
                  onPress={() => { tapHaptic(); setPenSize(s); }}
                  disabled={saving}
                  style={[styles.sizeKey, penSize === s && styles.sizeKeyOn]}
                  accessibilityRole="button"
                  accessibilityLabel={`Pen size ${s}`}
                  accessibilityState={{ selected: penSize === s }}
                  testID={`image-editor-size-${s}`}
                >
                  <View style={[styles.sizeDot, { width: s + 4, height: s + 4, borderRadius: (s + 4) / 2 }]} />
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* The sticker tool's own row: trace or tap, and how fussy the tap is.
            The tolerance keys only appear in wand mode — three dead chips over
            a lasso would be three things that do nothing. */}
        {tool === 'sticker' && (
          <View style={styles.penRow}>
            <Pressable
              onPress={() => { tapHaptic(); setWand((w) => !w); }}
              disabled={saving || wanding}
              style={({ pressed }) => [
                styles.wandKey,
                wand && styles.wandKeyOn,
                pressed && styles.pressed,
                (saving || wanding) && styles.disabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel={wand ? 'Switch back to tracing' : 'Select by tapping instead of tracing'}
              accessibilityState={{ selected: wand }}
              testID="image-editor-wand"
            >
              <Icon name="auto-fix" size={17} color="#fff" />
              <Text style={styles.wandLabel}>{wand ? 'Tap to pick' : 'Auto‑select'}</Text>
            </Pressable>

            {wand && (
              <View style={styles.sizes}>
                {WAND_TOLERANCES.map((t) => (
                  <Pressable
                    key={t.key}
                    onPress={() => { tapHaptic(); setTolerance(t.value); }}
                    disabled={saving || wanding}
                    style={[styles.tolKey, tolerance === t.value && styles.sizeKeyOn]}
                    accessibilityRole="button"
                    accessibilityLabel={`Match ${t.label.toLowerCase()}`}
                    accessibilityState={{ selected: tolerance === t.value }}
                    testID={`image-editor-tolerance-${t.key}`}
                  >
                    <Text style={styles.tolLabel}>{t.label}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )}

        {/* The tools. A row that wraps and shrinks per the app-wide rule: it
            must never lay out past its own edge as tools are added. */}
        <View style={styles.toolRow}>
          <Pressable
            onPress={tool === 'rotate' ? rotate : () => selectTool('rotate')}
            disabled={saving}
            style={({ pressed }) => [
              styles.tool,
              tool === 'rotate' && { backgroundColor: 'rgba(255,255,255,0.22)' },
              pressed && styles.pressed,
              saving && styles.disabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel={tool === 'rotate' ? 'Rotate 90 degrees clockwise' : 'Rotate'}
            accessibilityState={{ selected: tool === 'rotate' }}
            testID="image-editor-rotate"
          >
            <Icon name="rotate-right" size={26} color="#fff" />
            <Text style={styles.toolLabel}>Rotate</Text>
          </Pressable>

          <Pressable
            onPress={() => selectTool('draw')}
            disabled={saving}
            style={({ pressed }) => [
              styles.tool,
              tool === 'draw' && { backgroundColor: 'rgba(255,255,255,0.22)' },
              pressed && styles.pressed,
              saving && styles.disabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Draw on this photo"
            accessibilityState={{ selected: tool === 'draw' }}
            testID="image-editor-draw"
          >
            <Icon name="draw" size={26} color="#fff" />
            <Text style={styles.toolLabel}>Draw</Text>
          </Pressable>

          <Pressable
            onPress={() => selectTool('sticker')}
            disabled={saving}
            style={({ pressed }) => [
              styles.tool,
              tool === 'sticker' && { backgroundColor: 'rgba(255,255,255,0.22)' },
              pressed && styles.pressed,
              saving && styles.disabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Cut out a sticker"
            accessibilityState={{ selected: tool === 'sticker' }}
            testID="image-editor-sticker"
          >
            <Icon name="sticker-outline" size={26} color="#fff" />
            <Text style={styles.toolLabel}>Sticker</Text>
          </Pressable>

          {drawing && (
            <Pressable
              onPress={undo}
              disabled={saving || !canUndo}
              style={({ pressed }) => [
                styles.tool,
                pressed && styles.pressed,
                (saving || !canUndo) && styles.disabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel={tool === 'sticker' ? 'Clear the outline' : 'Undo the last stroke'}
              testID="image-editor-undo"
            >
              <Icon name="undo-variant" size={26} color="#fff" />
              <Text style={styles.toolLabel}>{tool === 'sticker' ? 'Clear' : 'Undo'}</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.actions}>
          <Pressable
            onPress={cancel}
            disabled={saving}
            style={({ pressed }) => [styles.action, pressed && styles.pressed, saving && styles.disabled]}
            accessibilityRole="button"
            testID="image-editor-cancel"
          >
            <Text style={styles.actionText}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={save}
            disabled={saving}
            style={({ pressed }) => [
              styles.action,
              styles.saveAction,
              { backgroundColor: dirty ? tint : 'rgba(255,255,255,0.14)' },
              pressed && styles.pressed,
              saving && styles.disabled,
            ]}
            accessibilityRole="button"
            testID="image-editor-save"
          >
            <Text style={[styles.actionText, styles.saveText]}>
              {saving ? 'Saving…' : tool === 'rotate' ? 'Save' : 'Save a copy'}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    // Over the viewer's chrome (5), its share "preparing" card (300) and its
    // sheets (1000). `elevation` says the same thing to Android, which orders
    // siblings by elevation and ignores zIndex on its own.
    zIndex: 1100,
    elevation: 1100,
  },
  header: {
    paddingHorizontal: 18,
    paddingBottom: 10,
  },
  title: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  hint: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    marginTop: 2,
  },
  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  surface: {
    ...StyleSheet.absoluteFillObject,
  },
  savingVeil: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  tools: {
    paddingTop: 14,
    paddingHorizontal: 18,
    gap: 16,
  },
  penRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  swatches: {
    alignItems: 'center',
    gap: 10,
    paddingRight: 4,
  },
  swatch: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  swatchOn: {
    borderColor: '#fff',
    // Scaled rather than ring-expanded: a growing border would move its
    // neighbours along the row every time the selection changed.
    transform: [{ scale: 1.15 }],
  },
  sizes: {
    flexDirection: 'row',
    gap: 6,
  },
  sizeKey: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  sizeKeyOn: {
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  sizeDot: {
    backgroundColor: '#fff',
  },
  // The wand toggle and its three match keys. flexShrink on the toggle and a
  // capped label width, per the app-wide rule: this row gains controls when the
  // wand is on and must narrow rather than run past its own edge.
  wandKey: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flexShrink: 1,
    minWidth: 0,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  wandKeyOn: {
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  wandLabel: { color: '#fff', fontSize: 13, fontWeight: '700', flexShrink: 1 },
  tolKey: {
    height: 34,
    paddingHorizontal: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  tolLabel: { color: '#fff', fontSize: 12, fontWeight: '700' },
  toolRow: {
    flexDirection: 'row',
    // Wrap + shrink per the app-wide rule: a tool row must never lay out past
    // its own edge once there is more than one tool in it.
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
  },
  tool: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    flexShrink: 1,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  toolLabel: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  action: {
    flex: 1,
    flexShrink: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  saveAction: {},
  actionText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  saveText: {
    color: '#fff',
  },
  pressed: {
    opacity: 0.6,
  },
  disabled: {
    opacity: 0.5,
  },
});
