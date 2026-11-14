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
    // It hangs from the ridge: lifted by its own ledge line, touch-transparent.
    expect(src).toMatch(/<View pointerEvents="none" style=\{styles\.claudePeek\} testID="claude-mark-peek">/);
    expect(src).toMatch(/top: -ledgeOffset\(CLAUDE_PEEK_WIDTH\)/);
    // No circle and no plate: the peek's style positions it and nothing else.
    const peek = src.slice(src.indexOf('    claudePeek: {'), src.indexOf('    headerClaudeRow: {'));
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
