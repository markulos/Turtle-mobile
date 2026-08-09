// Pure-logic tests for the sheet drag-dismiss gate.
//
// The hook itself is a PanResponder + Animated wrapper (needs a renderer), but
// every decision it makes lives in two exported pure functions. Those are what
// can actually regress: the whole-card responder now runs in the CAPTURE phase,
// so a wrong `true` here steals scrolling from every list inside every sheet.
import { shouldClaimDrag, isAtTop, DRAG_SLOP, COMMIT_DY, COMMIT_VY, shouldCommit } from '../useSheetDismiss';

const g = (dy, dx = 0, vy = 0) => ({ dy, dx, vy });

describe('shouldClaimDrag', () => {
  const open = { blocked: false, atTop: true };

  it('claims a deliberate downward drag when the content is at the top', () => {
    expect(shouldClaimDrag(g(DRAG_SLOP + 1), open)).toBe(true);
  });

  it('ignores a drag that has not passed the slop', () => {
    expect(shouldClaimDrag(g(DRAG_SLOP), open)).toBe(false);
    expect(shouldClaimDrag(g(1), open)).toBe(false);
  });

  it('ignores upward drags — the card only closes downward', () => {
    expect(shouldClaimDrag(g(-40), open)).toBe(false);
  });

  it('ignores a mostly-horizontal drag so pagers and swipe rows still work', () => {
    expect(shouldClaimDrag(g(10, 40), open)).toBe(false);
    // Diagonal but vertical-dominant still counts.
    expect(shouldClaimDrag(g(40, 10), open)).toBe(true);
  });

  it('does not claim while a scrollable inside the sheet is scrolled down', () => {
    expect(shouldClaimDrag(g(40), { blocked: false, atTop: false })).toBe(false);
  });

  it('does not claim inside a no-drag zone (wheels, sliders)', () => {
    expect(shouldClaimDrag(g(40), { blocked: true, atTop: true })).toBe(false);
  });
});

describe('isAtTop', () => {
  it('is true when nothing has scrolled yet', () => {
    expect(isAtTop(new Map())).toBe(true);
  });

  it('tolerates sub-pixel and rubber-band negative offsets', () => {
    expect(isAtTop(new Map([['body', 0.5]]))).toBe(true);
    expect(isAtTop(new Map([['body', -30]]))).toBe(true);
  });

  it('is false as soon as any registered scrollable has scrolled', () => {
    expect(isAtTop(new Map([['body', 120]]))).toBe(false);
    expect(isAtTop(new Map([['body', 0], ['playlist', 80]]))).toBe(false);
  });
});

describe('shouldCommit', () => {
  it('commits past the distance threshold', () => {
    expect(shouldCommit(g(COMMIT_DY + 1))).toBe(true);
    expect(shouldCommit(g(COMMIT_DY - 1))).toBe(false);
  });

  it('commits on a downward flick that never travelled far', () => {
    expect(shouldCommit(g(20, 0, COMMIT_VY + 0.1))).toBe(true);
  });
});
