/**
 * ClaudeTurtleMark — the owner's sketch, standing in for the stock robot.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen } from '@testing-library/react-native';

// The native SVG module is not present on every machine that runs this suite.
jest.mock('react-native-svg', () => {
  const React = require('react');
  const { View } = require('react-native');
  const make = (name) => {
    const C = ({ children, ...props }) => React.createElement(View, { testID: 'svg-' + name, ...props }, children);
    C.displayName = name;
    return C;
  };
  return { __esModule: true, default: make('Svg'), Path: make('Path'), G: make('G'), Circle: make('Circle') };
}, { virtual: true });

import ClaudeTurtleMark, {
  CLAUDE_MARK_ASPECT,
  CLAUDE_MARK_COLOR,
  CLAUDE_MARK_LEVEL,
  CLAUDE_MARK_NIGHT,
  artPoint,
  facePath,
  CLAUDE_MARK_LEDGE,
  ledgeOffset,
  markHeight,
  penFor,
} from '../ClaudeTurtleMark';

const parts = (tag) => screen.getAllByTestId('svg-' + tag);

describe('ClaudeTurtleMark', () => {
  test('is the whole drawing: a head, two hands, two eyes', async () => {
    await render(<ClaudeTurtleMark />);
    expect(parts('Path')).toHaveLength(3);
    expect(parts('Circle')).toHaveLength(2);
  });

  test('`size` is its width; the height follows the drawing', async () => {
    await render(<ClaudeTurtleMark size={24} />);
    const svg = screen.getByTestId('claude-turtle-mark');
    expect(svg.props.width).toBe(24);
    expect(svg.props.height).toBeCloseTo(24 / CLAUDE_MARK_ASPECT);
    // Wide, not square — which is what leaves air above and below it in a ring.
    expect(CLAUDE_MARK_ASPECT).toBeGreaterThan(2);
  });

  test('it is a line drawing in the pen colour, not a filled shape', async () => {
    await render(<ClaudeTurtleMark />);
    for (const p of parts('Path')) {
      expect(p.props.fill).toBe('none');
      expect(p.props.stroke).toBe(CLAUDE_MARK_COLOR);
      expect(p.props.strokeLinecap).toBe('round');
      expect(p.props.strokeLinejoin).toBe('round');
    }
  });

  test('takes another colour when a surface needs one', async () => {
    await render(<ClaudeTurtleMark color="#FFFFFF" />);
    expect(parts('Path')[0].props.stroke).toBe('#FFFFFF');
    expect(parts('Circle')[0].props.fill).toBe('#FFFFFF');
  });

  test('the pen holds its weight on screen as the mark shrinks', () => {
    // 1.3 points at 24 wide and at 48 wide is the same line on the glass, so
    // the smaller one needs twice the width in drawing units.
    expect(penFor(24, 1.3)).toBeCloseTo(penFor(48, 1.3) * 2);
    // And it is never thinner than the pen it was drawn with.
    expect(penFor(2000, 1.3)).toBe(7);
  });

  test('the eyes do not vanish at icon size', async () => {
    await render(<ClaudeTurtleMark size={24} weight={1.3} />);
    const pen = parts('Path')[0].props.strokeWidth;
    for (const eye of parts('Circle')) {
      // A dot at least as heavy as the line beside it.
      expect(eye.props.r * 2).toBeGreaterThanOrEqual(pen);
    }
  });

  test('handFill fills the HANDS and never the head', async () => {
    // A rule runs along the ledge, through the middle of the hands. Unfilled,
    // the line shows straight through them and the fingers read as drawn ON
    // it rather than resting over it; filled with what is behind, they
    // occlude it and sit on top.
    await render(<ClaudeTurtleMark handFill="#FFFFFF" />);
    const fills = parts('Path').map((n) => n.props.fill);
    expect(fills).toHaveLength(3);
    expect(fills.filter((f) => f === '#FFFFFF')).toHaveLength(2);
    // The head is never filled whatever is passed: its outline deliberately
    // does not close on the right, so a fill would leak across the gap.
    expect(fills.filter((f) => f === 'none')).toHaveLength(1);
  });

  test('as drawn by default; `tilt` turns the whole drawing about its centre', async () => {
    const { unmount } = await render(<ClaudeTurtleMark />);
    expect(screen.getByTestId('claude-turtle-mark-art').props.transform).toBeUndefined();
    await unmount();
    await render(<ClaudeTurtleMark tilt={2.3} />);
    // About the middle of the art (viewBox 30 54 316 136), so one hand comes
    // up as far as the other goes down and the ledge between them stays put.
    expect(screen.getByTestId('claude-turtle-mark-art').props.transform).toBe('rotate(2.3 188 122)');
  });

  test('CLAUDE_MARK_LEVEL puts the hands level, and the header uses it', () => {
    // Measured off Mark's mock-up (2026-11-15): 2.2–2.35° clockwise.
    expect(CLAUDE_MARK_LEVEL).toBeGreaterThanOrEqual(2);
    expect(CLAUDE_MARK_LEVEL).toBeLessThanOrEqual(2.6);
    // What it is for: the hand centres as drawn are (77.5, 151.5) and
    // (301, 135) — the right one 16.5 units higher. Turned, the gap more
    // than halves, and the two straddle the ledge line at 150.
    const a = (CLAUDE_MARK_LEVEL * Math.PI) / 180;
    const yAfter = (x, y) => 122 + (x - 188) * Math.sin(a) + (y - 122) * Math.cos(a);
    const left = yAfter(77.5, 151.5);
    const right = yAfter(301, 135);
    expect(Math.abs(left - right)).toBeLessThan(16.5 / 2);
    expect(left).toBeLessThan(151.5);
    expect(right).toBeGreaterThan(135);
    const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'screens', 'TurtleScreen', 'index.jsx'), 'utf8');
    expect(src).toMatch(/tilt=\{CLAUDE_MARK_LEVEL\}/);
  });

  test('AT NIGHT it is a white figure with a black line', async () => {
    // Mark (2026-11-15): in dark mode, white fill with the outline black.
    expect(CLAUDE_MARK_NIGHT).toEqual({ line: '#000000', fill: '#FFFFFF' });
    await render(
      <ClaudeTurtleMark color={CLAUDE_MARK_NIGHT.line} handFill={CLAUDE_MARK_NIGHT.fill} faceFill={CLAUDE_MARK_NIGHT.fill} />,
    );
    // The face is a shape of its own, behind the line — and has no outline
    // of its own to double the stroke.
    const face = screen.getByTestId('claude-turtle-mark-face');
    expect(face.props.fill).toBe('#FFFFFF');
    expect(face.props.stroke).toBe('none');
    // Eyes take the line colour, so they are black on the white face.
    for (const eye of screen.getAllByTestId('svg-Circle')) expect(eye.props.fill).toBe('#000000');
    const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'screens', 'TurtleScreen', 'index.jsx'), 'utf8');
    expect(src).toMatch(/color=\{theme\.mode === 'dark' \? CLAUDE_MARK_NIGHT\.line : undefined\}/);
    expect(src).toMatch(/faceFill=\{theme\.mode === 'dark' \? CLAUDE_MARK_NIGHT\.fill : 'none'\}/);
  });

  test('no face shape unless one is asked for — by day it is still a line drawing', async () => {
    await render(<ClaudeTurtleMark />);
    expect(screen.queryByTestId('claude-turtle-mark-face')).toBeNull();
  });

  test('the filled face ends LEVEL, just above the ledge, whatever the tilt', () => {
    // The base is drawn pre-turned, so that once the drawing is turned it is
    // parallel to the ridge. Turn its two ends and they share a height —
    // one unit above the ledge line (150), so the face is behind the ridge.
    for (const tilt of [0, CLAUDE_MARK_LEVEL, 5]) {
      const nums = facePath(tilt).split(' L').slice(1).map((p) => p.replace(' Z', '').split(' ').map(Number));
      const a = (tilt * Math.PI) / 180;
      const turnedY = ([x, y]) => 122 + (x - 188) * Math.sin(a) + (y - 122) * Math.cos(a);
      expect(turnedY(nums[0])).toBeCloseTo(149, 1);
      expect(turnedY(nums[1])).toBeCloseTo(149, 1);
    }
    // Closed, and closed along that base — not corner to corner across the smile.
    expect(facePath(0)).toMatch(/ Z$/);
  });

  test('it can be drawn a LAYER at a time, for the animated mark', async () => {
    const both = await render(<ClaudeTurtleMark parts={['hands']} handFill="#FFFFFF" />);
    expect(parts('Path')).toHaveLength(2);
    expect(screen.queryAllByTestId('svg-Circle')).toHaveLength(0);
    await both.unmount();
    // One hand alone — the one the animated mark lifts to the chin, and the
    // one it leaves on the ledge.
    const left = await render(<ClaudeTurtleMark parts={['leftHand']} />);
    expect(parts('Path')).toHaveLength(1);
    expect(parts('Path')[0].props.d).toMatch(/^M44 160/);
    await left.unmount();
    await render(<ClaudeTurtleMark parts={['rightHand']} />);
    expect(parts('Path')).toHaveLength(1);
    expect(parts('Path')[0].props.d).toMatch(/^M338 128/);
  });

  test('there is no raised finger in the drawing', () => {
    // It was the first thinking pose, and it read as a tail (Mark, 2026-11-15).
    const mark = fs.readFileSync(path.resolve(__dirname, '..', 'ClaudeTurtleMark.jsx'), 'utf8');
    expect(mark).not.toMatch(/FINGER_UP|includes..finger/);
  });

  test('artPoint places a point of the drawing on a turned mark', () => {
    // The centre of the art does not move, whatever the turn.
    expect(artPoint(316, 0, 188, 122)).toEqual({ x: 158, y: 68 });
    const c = artPoint(316, 30, 188, 122);
    expect(c.x).toBeCloseTo(158);
    expect(c.y).toBeCloseTo(68);
    // Clockwise: a point to the right of centre goes DOWN.
    expect(artPoint(316, 10, 288, 122).y).toBeGreaterThan(68);
  });

  test('the ledge runs under the chin and through the hands', () => {



    // Above the line: the whole face. Below it: only fingers. That is what
    // makes it hang OVER an edge instead of sitting on one.
    expect(CLAUDE_MARK_LEDGE).toBeGreaterThan(0.6);
    expect(CLAUDE_MARK_LEDGE).toBeLessThan(0.8);
    expect(ledgeOffset(44)).toBeCloseTo((44 / CLAUDE_MARK_ASPECT) * CLAUDE_MARK_LEDGE);
  });

  test('the session header hangs it over the ridge, with no ring around it', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'screens', 'TurtleScreen', 'index.jsx'), 'utf8');
    // Not in the avatar ring any more — and the robot is not back in it.
    const ring = src.slice(src.indexOf('styles.identityAvatarRing'), src.indexOf('styles.identityDot'));
    expect(ring).not.toMatch(/ClaudeTurtleMark/);
    expect(ring).not.toMatch(/robot-outline/);
    // Signing in is still a door, in its ring.
    expect(ring).toMatch(/login-variant/);
    // The ring itself stands down for a live session.
    expect(src).toMatch(/\{!claudeMarkShown && \(\s*<View style=\{styles\.identityAvatarWrap\}>/);
    // Touch-transparent: the identity bar underneath keeps the tap.
    expect(src).toMatch(/<View pointerEvents="none" style=\{styles\.claudePeek\} testID="claude-mark-peek">/);
    // Hung from the row's CENTRE line by its own ledge, so that line runs
    // under the chin and through the hands. Both numbers come from the art.
    const peek = src.slice(src.indexOf('    claudePeek: {'), src.indexOf('    claudeRidge: {'));
    expect(peek).toMatch(/position: 'absolute',/);
    expect(peek).toMatch(/top: '50%',/);
    expect(peek).toMatch(/marginTop: -ledgeOffset\(CLAUDE_PEEK_WIDTH\),/);
    // No circle and no plate: the style positions it and nothing else.
    expect(peek).not.toMatch(/border|backgroundColor/);
    // …and there is no controls row under it to draw a second rule.
    expect(src).not.toMatch(/headerClaudeRow|headerClaudeWrap/);
  });

  test('THE TITLE AND THE MARK SHARE THE RIDGE — centred on it, not stood on it', () => {
    // Mark's mock-up (2026-11-15): the title block centred on the line the
    // hands hold, the rule running edge to edge but never through the words.
    const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'screens', 'TurtleScreen', 'index.jsx'), 'utf8');
    // The ridge is a flex child of the identity bar, which centres its
    // children: so the rule IS the title's middle, with nothing measured.
    const from = src.indexOf('styles.identityBar, claudeMarkShown && styles.identityBarOnRidge');
    const bar = src.slice(from, src.indexOf('</TouchableOpacity>', from));
    const lead = bar.indexOf('style={styles.claudeRidgeLead}');
    const title = bar.indexOf('style={claudeMarkShown ? styles.identityTextOnRidge : styles.identityText}');
    const ridge = bar.indexOf('style={styles.claudeRidge} testID="claude-ridge"');
    expect(lead).toBeGreaterThan(-1);
    expect(title).toBeGreaterThan(lead);
    expect(ridge).toBeGreaterThan(title);
    const barStyle = src.slice(src.indexOf('    identityBar: {'), src.indexOf('    identityAvatarWrap: {'));
    expect(barStyle).toMatch(/alignItems: 'center',/);
    // The title is as wide as its words, so the rule starts where they end.
    //
    // THE BUG THIS PINS (device, 2026-11-15): the ridge style was layered
    // over identityText, which carries `flex: 1`. In Yoga a `flex: 1` still
    // in the merged style makes `flexBasis: 'auto'` a basis of ZERO, so the
    // title was 0pt wide and the header shipped with no name in it. A
    // browser resolves the same styles the other way, so the mock-up was
    // fine. One style or the other, and the ridge one says nothing about
    // `flex` or `flexBasis`.
    expect(src).not.toMatch(/styles\.identityText, claudeMarkShown/);
    const onRidge = /identityTextOnRidge: \{([^}]*)\},/.exec(src)[1];
    expect(onRidge).toMatch(/flexShrink: 1/);
    expect(onRidge).not.toMatch(/flex:|flexBasis|flexGrow/);
    // …and nothing is painted behind the words to hide a line under them.
    const titleStyles = src.slice(src.indexOf('    identityBarOnRidge: {'), src.indexOf('    composerControls: {'));
    expect(titleStyles).not.toMatch(/backgroundColor/);
    // Edge to edge: the long run undoes the inset and the gutter on the
    // right, the lead-in starts at the gutter on the left.
    const run = src.slice(src.indexOf('    claudeRidge: {'), src.indexOf('    claudeRidgeLead: {'));
    expect(run).toMatch(/marginRight: -\(HEADER_GUTTER \+ IDENTITY_INSET\),/);
    // A long title gives way before it runs under the drawing.
    expect(run).toMatch(/minWidth: HEADER_GUTTER \+ theme\.spacing\.lg \/ 2 \+ CLAUDE_PEEK_WIDTH \+ CLAUDE_RIDGE_GAP,/);
    const leadStyle = src.slice(src.indexOf('    claudeRidgeLead: {'), src.indexOf('    identityBarOnRidge: {'));
    expect(leadStyle).toMatch(/left: -HEADER_GUTTER,/);
    expect(leadStyle).toMatch(/top: '50%',/);
    // UNDER the hands: the ridge comes before the mark in the tree, and the
    // hands are filled, so the rule passes behind them.
    expect(src.indexOf('style={styles.claudeRidge}')).toBeLessThan(src.indexOf('style={styles.claudePeek}'));
    // Visible: a point of a text tone, not a hairline of the border colour
    // (which was drawn and could not be seen).
    expect(src).toMatch(/const CLAUDE_RIDGE_WEIGHT = 1;/);
    expect(run).toMatch(/backgroundColor: theme\.colors\.textTertiary,/);
    expect(run).not.toMatch(/hairlineWidth|colors\.border/);
  });

  test('ONE MARK PER CORNER — the brand turtle stands down for it', () => {
    // Both marks were drawn in the same corner, so neither had room: the
    // sketch came out as a squiggle tucked under a 22pt turtle (Mark's
    // screenshot, 2026-11-14). The turtle leaves on exactly the condition
    // that brings the mark in, the same one that drops the leading avatar
    // ring — if those two ever disagree the corner is crowded again.
    const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'screens', 'TurtleScreen', 'index.jsx'), 'utf8');
    expect(src).toMatch(/\{!claudeMarkShown && \(\s*<Image\s+source=\{turtleLogo\}/);
  });

  test('the hands are filled with what is BEHIND them, so they sit on the rule', () => {
    // An unfilled hand lets the ledge rule straight through, and the fingers
    // read as drawn ON the line instead of resting over it. The head is
    // never filled whatever is passed: its outline deliberately does not
    // close on the right, so a fill would leak across the gap.
    const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'screens', 'TurtleScreen', 'index.jsx'), 'utf8');
    expect(src).toMatch(/handFill=\{theme\.mode === 'dark' \? CLAUDE_MARK_NIGHT\.fill : theme\.colors\.background\}/);
  });

  test('THE LINE DOES NOT MOVE when a session starts — NO SECOND ROW', () => {
    // Mark, three times now: the ridge must be in the same place whether a
    // session is open or closed. It jumped because the header grew a row of
    // controls in a session — so its edge moved, and with it everything
    // measured from it. The header is ONE row in both states; the controls
    // are in the composer's corner.
    const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'screens', 'TurtleScreen', 'index.jsx'), 'utf8');
    const headerJsx = src.slice(src.indexOf('style={[styles.chatHeader,'), src.indexOf('{/* History failed to load'));
    expect(headerJsx).not.toMatch(/<ClaudeSessionControls/);
    // Exactly one cluster of controls on the screen, and it is the compact
    // one inside the composer.
    expect(src.match(/<ClaudeSessionControls/g)).toHaveLength(1);
    const composer = src.slice(src.indexOf('<ChatComposer'));
    expect(composer).toMatch(/\{inClaudeSession && \(\s*<ClaudeSessionControls\s+compact\s+style=\{styles\.composerControls\}/);
    // The same padding above and below the row in both states — neither is
    // conditional on the session.
    expect(src).toMatch(/const HEADER_PAD_BOTTOM = \d+;/);
    expect(src).toMatch(/const HEADER_PAD_TOP = \d+;/);
    const header = src.slice(src.indexOf('    chatHeader: {'), src.indexOf('    headerEdge: {'));
    expect(header).toMatch(/paddingBottom: HEADER_PAD_BOTTOM,/);
    expect(src).toMatch(/style=\{\[styles\.chatHeader, \{ paddingTop: insets\.top \+ HEADER_PAD_TOP \}, headerCounterStyle\]\}/);
    // …and the row itself is one height in both: out of a session the
    // search key set it, in one nothing did.
    const row = src.slice(src.indexOf('    headerTopRow: {'), src.indexOf('    claudePeek: {'));
    expect(row).toMatch(/minHeight: HEADER_ROW_MIN_HEIGHT,/);
    // The seam that stood in for the header edge is gone with the row that
    // made it necessary.
    expect(src).not.toMatch(/claudeSeam/);
    expect(src).toMatch(/style=\{styles\.claudeRidge\}/);
  });

  test('the controls in the composer are the COMPACT form: packed right, the status pill gives way', () => {
    const ctl = fs.readFileSync(path.resolve(__dirname, '..', '..', 'screens', 'TurtleScreen', 'components', 'ClaudeSessionControls.jsx'), 'utf8');
    expect(ctl).toMatch(/compact = false,/);
    expect(ctl).toMatch(/rowCompact: \{ justifyContent: 'flex-end', gap: 6 \},/);
    // No spacer splitting the cluster in two when it is in a corner.
    expect(ctl).toMatch(/\{!compact && <View style=\{styles\.spacer\} \/>\}/);
    // In the composer it starts from the width of its own buttons — `flex: 1`
    // would be a basis of zero — and attached thumbs sit on a line above it
    // rather than fighting it for the row.
    const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'screens', 'TurtleScreen', 'index.jsx'), 'utf8');
    expect(src).toMatch(/composerControls: \{ flexGrow: 1, flexShrink: 1, minWidth: 0 \},/);
    const top = src.slice(src.indexOf('topSlot={'), src.indexOf('actions={'));
    expect(top.indexOf('styles.composerThumbRail')).toBeGreaterThan(top.indexOf('styles.composerTopStack'));
    expect(top.indexOf('styles.composerTopRow')).toBeGreaterThan(top.indexOf('styles.composerThumbRail'));
    expect(top.indexOf('<ClaudeSessionControls')).toBeGreaterThan(top.indexOf('styles.botSlot'));
    // The pill shrinks; the buttons do not (they carry the labels you tap).
    expect(ctl).toMatch(/statusPillCompact: \{ flexShrink: 1, minWidth: 0 \},/);
    // One line, whatever the state word is — a two-line pill would grow the
    // composer's corner. (The pill is also the live toggle now; what it says
    // and how it behaves is ClaudeSessionControls.test's business.)
    expect(ctl).toMatch(/numberOfLines=\{1\}\s*>\{statusText\}/);
  });

  test('…and takes the corner it is now alone in', () => {
    // 44 was what fitted BESIDE something else. Sized to the corner, the
    // drawing is legible: about 35pt tall, a touch over half above the
    // ridge with the fingers draped below.
    const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'screens', 'TurtleScreen', 'index.jsx'), 'utf8');
    const width = Number(/const CLAUDE_PEEK_WIDTH = (\d+);/.exec(src)[1]);
    expect(width).toBeGreaterThanOrEqual(72);
    // …and still inside the header: the ridge is the row's centre line, so
    // the face stands half a row plus a little above it. More than a few
    // points over the row's top and it is in the status bar.
    const rowHeight = Number(/const HEADER_ROW_MIN_HEIGHT = (\d+);/.exec(src)[1]);
    expect(ledgeOffset(width) - rowHeight / 2).toBeLessThanOrEqual(4);
    // And the fingers end inside the row, clear of the seam under it.
    expect(markHeight(width) - ledgeOffset(width)).toBeLessThan(rowHeight / 2);
  });
});
