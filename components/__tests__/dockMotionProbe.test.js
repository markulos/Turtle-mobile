import { describeDockMotion, describeDockTouch, framesMissing } from '../dockMotionProbe';

/**
 * The probe's arithmetic and the sentence it turns into.
 *
 * The frame callback itself cannot be tested here — it runs on Reanimated's UI
 * thread and there is no UI thread in jest. What CAN be pinned is the part
 * that decides what the numbers mean, because that is what will be read off a
 * phone and acted on: a readout that calls a clean move stuttery would send
 * the next change in the wrong direction, which is the failure this whole
 * thing exists to stop.
 */

describe('framesMissing', () => {
  it('counts nothing missing when every frame arrived', () => {
    // 160ms at 120Hz = 19 frames of 8.33ms.
    expect(framesMissing(160, 8.33, 19)).toBe(0);
  });

  it('counts the frame times a hitch swallowed', () => {
    // Same window, but only 12 frames were delivered: 7 frame times went by
    // without the chip being drawn.
    expect(framesMissing(160, 8.33, 12)).toBe(7);
  });

  it('reads 60Hz and 120Hz the same way, without being told which', () => {
    // A clean 200ms move: 24 frames at 120Hz, 12 at 60Hz. Neither is a drop.
    expect(framesMissing(200, 8.33, 24)).toBe(0);
    expect(framesMissing(200, 16.67, 12)).toBe(0);
    // And one lost frame on each device reads as one.
    expect(framesMissing(200, 8.33, 23)).toBe(1);
    expect(framesMissing(200, 16.67, 11)).toBe(1);
  });

  it('never reports a negative count', () => {
    // More frames than the arithmetic expects — a rounded best frame can do
    // this. It is not a credit; it is zero.
    expect(framesMissing(160, 8.33, 25)).toBe(0);
  });

  it('is zero rather than NaN before any frame has been seen', () => {
    // `best` is 0 until the first frame delta lands, and a report that
    // divided by it would put Infinity on screen.
    expect(framesMissing(160, 0, 0)).toBe(0);
    expect(framesMissing(0, 8.33, 0)).toBe(0);
  });
});

describe('describeDockMotion', () => {
  const clean = {
    startLateMs: 12, worstMs: 9, bestMs: 8.3, frames: 19, drops: 0, pressBusy: false, travelMs: 160,
  };

  it('asks for a tab change when nothing has been measured yet', () => {
    expect(describeDockMotion(null)).toMatch(/switch tabs/i);
  });

  it('calls a clean move clean', () => {
    expect(describeDockMotion(clean)).toMatch(/^Clean/);
  });

  it('blames the WAIT when the chip left late, even if it then ran clean', () => {
    // This is the distinction the readout exists for: a late start is a JS
    // thread problem and retiming the curve cannot touch it.
    const late = { ...clean, startLateMs: 180 };
    expect(describeDockMotion(late)).toMatch(/waiting, not stuttering/);
  });

  it('blames the FRAMES when the chip left on time and then stumbled', () => {
    const choppy = { ...clean, startLateMs: 10, drops: 4, worstMs: 41 };
    const said = describeDockMotion(choppy);
    expect(said).toMatch(/Lost 4 frames crossing/);
    expect(said).toMatch(/worst 41ms/);
  });

  it('names the press swell when it was still running during the travel', () => {
    const choppy = {
      ...clean, startLateMs: 10, drops: 3, worstMs: 33, pressBusy: true,
    };
    expect(describeDockMotion(choppy)).toMatch(/press still scaling the glass/);
  });

  it('says one frame rather than 1 frames', () => {
    expect(describeDockMotion({ ...clean, drops: 1 })).toMatch(/Lost 1 frame crossing/);
  });

  it('does not accuse a touch that never happened of being late', () => {
    // A tab change from a deep link or the /command console: -1, not a delay.
    const noTouch = { ...clean, startLateMs: -1 };
    expect(describeDockMotion(noTouch)).not.toMatch(/after (your|the) touch/);
  });
});

describe('describeDockTouch — why a tap did not change tabs', () => {
  // The two ways a dock touch produces no `tabPress` look identical from the
  // outside ("I pressed the tab and it did nothing") and want different
  // fixes. This sentence is the only thing that can tell them apart, so what
  // it says is worth pinning.
  const base = {
    touchSlot: 4, touchY: 30, panActivated: false, tapCompleted: false,
  };

  it('says nothing at all before anything has been measured', () => {
    expect(describeDockTouch(null)).toBe('');
  });

  it('an ordinary tap is the button’s business, not the dock’s', () => {
    expect(describeDockTouch(base)).toMatch(/the button handled it/);
  });

  it('names the MISSED BUTTON when the finger was off the capsule', () => {
    const off = { ...base, touchSlot: -1, touchY: 88, tapCompleted: true };
    const said = describeDockTouch(off);
    expect(said).toMatch(/missed the buttons/);
    expect(said).toMatch(/88pt down the dock/);
    expect(said).toMatch(/the dock made the tab change itself/);
  });

  it('names the DRAG when it ate a press on a real tab', () => {
    const eaten = { ...base, panActivated: true, tapCompleted: true };
    expect(describeDockTouch(eaten)).toMatch(/the drag ate the press/);
  });

  it('distinguishes a press that never arrived on a real tab', () => {
    const missing = { ...base, tapCompleted: true };
    const said = describeDockTouch(missing);
    expect(said).toMatch(/on a tab/);
    expect(said).toMatch(/the press never arrived/);
    expect(said).not.toMatch(/drag ate/);
  });

  it('a drag that chose on its own lift is not a rescue', () => {
    const drag = { ...base, panActivated: true, tapCompleted: false };
    const said = describeDockTouch(drag);
    expect(said).toMatch(/the drag took it/);
    expect(said).not.toMatch(/made the tab change itself/);
  });
});
