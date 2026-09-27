/**
 * The pomodoro's two side effects, driven from APP LEVEL: the iOS Live Activity
 * (Dynamic Island / lock screen) and the completion confetti.
 *
 * Both used to live inside `usePomodoroSocket`, i.e. inside the Turtle tab. The
 * bottom-tab navigator is lazy, so until that tab had been opened once neither
 * effect existed in the process: a focus block started on the desktop showed a
 * countdown on this phone's SCREEN (the timer state itself moved to the
 * app-level socket earlier) but put nothing on its lock screen, and a focus
 * block that ran out earned no confetti. This component mounts beside the other
 * app-level, nothing-rendering workers (PomodoroNotifications) and runs from
 * boot, off the same shared view the card draws — so the island and the card
 * can never disagree, and dismissing the card is what clears the island.
 *
 * Renders nothing. The DECISIONS are pure functions in utils/pomodoroState
 * (liveActivityAction / shouldCelebrate), tested there, because a Live Activity
 * cannot be exercised in jest and the rules are where the bugs would hide.
 */
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { useSyncSignals } from '../context/DownloadsContext';
import { useCelebration } from '../context/CelebrationContext';
import * as liveActivity from '../services/liveActivity';
import { liveActivityAction, shouldCelebrate } from '../utils/pomodoroState';

export default function PomodoroLiveEffects() {
  const { pomodoroView: view } = useSyncSignals();
  const { celebrate } = useCelebration();

  // Each effect keeps its OWN memory of the last status it saw. "A completion
  // this driver watched run" is a property of the driver, not of the timer.
  const prevActivityRef = useRef(null);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const action = liveActivityAction(prevActivityRef.current, view);
    if (action === 'running') liveActivity.showRunning(view.mode, view.endsAt);
    else if (action === 'completed') liveActivity.showCompleted(view.mode);
    else liveActivity.clear();
    prevActivityRef.current = view?.status || 'idle';
  }, [view]);

  const prevCelebRef = useRef(null);
  useEffect(() => {
    if (shouldCelebrate(prevCelebRef.current, view)) {
      celebrate({ points: 25, kind: 'pomodoro' });
    }
    prevCelebRef.current = view?.status || 'idle';
  }, [view, celebrate]);

  return null;
}
