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
  return { __esModule: true, default: make('Svg'), Path: make('Path'), Circle: make('Circle') };
}, { virtual: true });

import ClaudeTurtleMark, {
  CLAUDE_MARK_ASPECT,
  CLAUDE_MARK_COLOR,
  CLAUDE_MARK_LEDGE,
  ledgeOffset,
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
    // Touch-transparent, and level with the title rather than hung off the
    // row below — the row centres the two so they read as one line.
    expect(src).toMatch(/<View pointerEvents="none" style=\{styles\.claudePeek\} testID="claude-mark-peek">/);
    // The RULE goes to the mark, not the mark to the rule: it is drawn at the
    // ledge so it passes through the middle of the hands, and both numbers
    // come from the art rather than from a measurement of it.
    expect(src).toMatch(/marginBottom:\s*ledgeOffset\(CLAUDE_PEEK_WIDTH\) - markHeight\(CLAUDE_PEEK_WIDTH\)/);
    // Full width: the header's own gutter undone, so the rule is the ground
    // the mark stands on rather than an underline for the title.
    const ledge = src.slice(src.indexOf('    claudeLedge: {'));
    expect(ledge.slice(0, 400)).toMatch(/left: -12/);
    expect(ledge.slice(0, 400)).toMatch(/right: -12/);
    expect(ledge.slice(0, 600)).toMatch(/bottom: -HEADER_PAD_BOTTOM/);
    // …and the controls row must not draw a SECOND one eight points under it.
    const controls = src.slice(src.indexOf('    headerClaudeRow: {'), src.indexOf('    identityBar: {'));
    expect(controls).not.toMatch(/borderTopWidth/);
    // No circle and no plate: the peek's style positions it and nothing else.
    const peek = src.slice(src.indexOf('    claudePeek: {'), src.indexOf('    claudeLedge: {'));
    expect(peek).not.toMatch(/border|backgroundColor/);
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
    expect(src).toMatch(/handFill=\{theme\.colors\.background\}/);
  });

  test('THE LINE DOES NOT MOVE when a session starts', () => {
    // Out of a session the rule under the title is the header's own edge,
    // one bottom-padding below the identity row. Drawn at the row's bottom
    // instead, the ledge sat 14pt higher — so starting a session jumped the
    // line up and ending one dropped it back. Both now come off the same
    // constant, which is the only way they stay equal when it is retuned.
    const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'screens', 'TurtleScreen', 'index.jsx'), 'utf8');
    expect(src).toMatch(/const HEADER_PAD_BOTTOM = \d+;/);
    // The header's padding IS the constant — not a literal that happens to
    // match it today.
    const header = src.slice(src.indexOf('    chatHeader: {'), src.indexOf('    headerEdge: {'));
    expect(header).toMatch(/paddingBottom: HEADER_PAD_BOTTOM,/);
    // …and the mark drops by it too, or the drawing parts company with its
    // own ledge.
    expect(src).toMatch(/markHeight\(CLAUDE_PEEK_WIDTH\) - HEADER_PAD_BOTTOM/);
  });

  test('…and takes the corner it is now alone in', () => {
    // 44 was what fitted BESIDE something else. Sized to the corner, the
    // drawing is legible: about 35pt tall, a touch over half above the
    // ridge with the fingers draped below.
    const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'screens', 'TurtleScreen', 'index.jsx'), 'utf8');
    const width = Number(/const CLAUDE_PEEK_WIDTH = (\d+);/.exec(src)[1]);
    expect(width).toBeGreaterThanOrEqual(72);
    // …and still inside the header: what hangs ABOVE the ridge has to fit in
    // the identity row, whose content is 34pt tall. Clipping the face would
    // be the same bug with a bigger number.
    expect(ledgeOffset(width)).toBeLessThanOrEqual(34);
  });
});
