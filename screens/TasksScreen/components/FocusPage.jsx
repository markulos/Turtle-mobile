/**
 * FocusPage — the Planner's fourth view: focus blocks, what they add up to,
 * and the way in and out of one.
 *
 * Built from the same parts as the rest of the screen (docs/STYLE-RULES.md §1,
 * inset cards): a ring you can read at a glance, four stat tiles, a week's bar
 * chart, and one inset row per board. Nothing here is new furniture — it is
 * the Overview page's vocabulary pointed at time rather than at tasks.
 *
 * THE DECK is the page's one piece of motion, and it earns it:
 *   · idle      — the block's length on an empty bar.
 *   · running   — the bar fills as the block burns, and the deck BREATHES: a
 *                 slow 4s scale, the tempo of a calm breath, which is the
 *                 oldest trick there is for making a countdown feel like
 *                 company rather than a stopwatch.
 *   · starting  — one firm pulse out as the block takes.
 *   · ending    — a bloom: the deck swells, a success haptic lands, and the
 *                 chime sounds.
 * All of it on the native driver (transforms and opacity only), so a running
 * block costs nothing on the JS thread and the page stays scrollable.
 *
 * IT READS LIKE THE CHAT'S TIMER CARD, deliberately and to the digit: the same
 * ceiling-rounded MM:SS, the same bar filling left to right, the same
 * `ends ~H:MM` under it (TimerMessage). One timer in two places that count
 * differently is two timers as far as anyone using them is concerned.
 *
 * It replaces a RING, which was the wrong instrument twice over. The sweep was
 * drawn from two rotated half-discs — fiddly, and silently broken for the half
 * of its life nobody could see — and, worse, it was drawn BARE ON THE PAGE
 * while taking its ink from the inset-card palette, whose text is white in BOTH
 * modes. On the light page that put the clock, the state word and the entire
 * Start key in white on white: a ring that drained over nothing at all.
 *
 * THE COUNTDOWN RUNS HERE. It used to be that starting a block from this page
 * threw you onto the Turtle tab to watch the chat's timer card — which meant the
 * page with the ring on it was the one page that never showed a running block.
 * The screen now hands this page whatever timer is live (task-linked or not, see
 * the unified /pomodoro/widget read in the screen), so the ring is the timer and
 * the tab you started on is the tab you stay on.
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AppTextInput from '../../../components/AppTextInput';
import EdgeSwipePage from '../../TurtleScreen/components/EdgeSwipePage';
import { tapHaptic, impactHaptic, notifyHaptic } from '../../../utils/haptics';
import { playFocusComplete } from '../../../services/focusChime';
import { insetCardPalette } from '../utils/cardPalette';
import { boardLabel } from '../utils/taskHelpers';
import { focusStats, formatMinutes } from '../utils/focusStats';
import { rangeSummaries } from '../utils/focusRanges';
import FocusStatsPanel from './FocusStatsPanel';

// One breath in, one out. Slower than a real breath on purpose — matching it
// exactly reads as a pulse-ox monitor; a little slower reads as calm.
const BREATH_MS = 4000;
// How far the deck moves. A CARD is wide, so the numbers a ring could wear are
// far too big here: a 3.5% breath on this much surface is a wobble. The breath
// is meant to be felt rather than watched; only the bloom is meant to be seen.
const BREATH_TO = 1.012;
const KICK_TO = 1.03;
const BLOOM_TO = 1.05;
/**
 * How recently a block must have ended for its completion to be CELEBRATED.
 *
 * Timers do not tick while the app is suspended, so a block that ran out
 * twenty minutes ago finishes "now" as far as this page's interval is
 * concerned — and without this gate, opening the app would bloom, buzz and
 * chime for a pomodoro that ended while the phone was in a pocket. Two
 * minutes, matching the same freshness gate on the chat timer's confetti
 * (usePomodoroSocket).
 */
const FRESH_MS = 120000;

/**
 * MM:SS from a millisecond remainder — the chat timer card's reading exactly.
 *
 * CEILING, not floor, and that is the whole point of matching: a block is
 * started at 25 minutes minus a fraction of a millisecond, so flooring shows
 * 24:59 on the very first frame — a timer that has lost a second before it
 * began. Ceiling shows 25:00 until a real second has gone, and reaches 00:00
 * exactly at the end rather than one tick early.
 *
 * Minutes padded to two digits for the same reason: 09:05 and 9:05 are the same
 * number, but only one of them stops the readout shuffling sideways as the
 * tens digit comes and goes.
 */
export function clockFromMs(ms) {
  const total = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * The deck: the reading, the bar it burns down, and the one control.
 *
 * An INSET CARD, like every other piece of furniture on this page — which is
 * not decoration. The ring this replaces was drawn bare on the page while
 * wearing the inset palette's ink, and that palette's text is WHITE IN BOTH
 * MODES (cardPalette.js: the cards are charcoal panels on the light page too).
 * A charcoal card under that ink is the only arrangement where it reads.
 *
 * The bar is scaled, not re-laid-out: `scaleX` on the native driver from a
 * left origin, so the fill grows smoothly BETWEEN the once-a-second re-renders
 * instead of stepping with them. Animating `width` would land it on the JS
 * thread and stutter the moment the page is scrolled.
 */
function FocusDeck({
  running, remaining, focusMinutes, block, todaySessions,
  progress, pulse, pal, accent, breakAccent,
  task, onPickTask, onClearTask, onJot,
  onStartFocus, onStartBreak, onStop,
}) {
  // The thought being parked. Local: it is a scratch line, not screen state,
  // and it exists only while a block is running.
  const [jot, setJot] = useState('');
  const sendJot = useCallback(() => {
    const line = jot.trim();
    if (!line) return;
    notifyHaptic('success');
    onJot?.(line);
    // Cleared and still focused — a distraction is rarely one thought.
    setJot('');
  }, [jot, onJot]);
  // A running block's own length, an idle one's planned length. The first comes
  // off the server, so a block started elsewhere reads its true length here.
  const minutes = (running && block?.durationMinutes) || focusMinutes;
  const ends = running && block?.endsAt
    ? new Date(block.endsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : null;
  // A BREAK is the same deck wearing a different colour and word. It has to be
  // unmistakable at a glance — starting the wrong one and noticing five minutes
  // later is the failure — and colour does that faster than reading does.
  const isBreak = running && block?.mode === 'break';
  const tint = isBreak ? breakAccent : accent;
  return (
    <Animated.View
      testID="focus-deck"
      style={[
        styles.deck,
        { backgroundColor: pal.card, borderColor: pal.edge, borderTopColor: pal.edgeTop },
        { transform: [{ scale: pulse }] },
      ]}
    >
      <View style={styles.deckHead}>
        <View style={[styles.badge, { backgroundColor: pal.tile }]}>
          <Icon name={isBreak ? 'coffee' : 'brain'} size={12} color={tint} />
          <Text style={[styles.badgeText, { color: tint }]} testID="focus-mode-badge">
            {isBreak ? 'BREAK' : 'FOCUS'}
          </Text>
        </View>
        <Text style={[styles.deckMeta, { color: pal.muted }]} numberOfLines={1}>{minutes} min</Text>
      </View>

      <View style={styles.clockRow}>
        <Text style={[styles.clock, { color: pal.text }]} numberOfLines={1} testID="focus-clock">
          {clockFromMs(running ? remaining : focusMinutes * 60000)}
        </Text>
        {/* WHAT THE BLOCK IS FOR, beside the reading of how long is left.
            Once it is running the task stops being a choice and becomes a
            fact, so it moves up out of the field that picked it and sits with
            the clock — one line saying "this, for this long".
            Thin, and allowed to wrap: it is the SUBJECT, not the headline, and
            a truncated task name is the one thing on this deck you cannot
            infer from anything else on it. */}
        {running && !!task?.title && (
          <Text
            style={[styles.runTask, { color: pal.sub }]}
            numberOfLines={3}
            testID="focus-run-task"
          >
            {task.title}
          </Text>
        )}
      </View>

      <View style={[styles.barTrack, { backgroundColor: pal.track }]} testID="focus-bar-track">
        <Animated.View
          testID="focus-bar-fill"
          style={[styles.barFill, { backgroundColor: tint, transform: [{ scaleX: progress }] }]}
        />
      </View>

      <Text style={[styles.deckNote, { color: pal.muted }]} numberOfLines={1} testID="focus-deck-note">
        {running
          ? `ends ~${ends}`
          : todaySessions
            ? `${todaySessions === 1 ? '1 block' : `${todaySessions} blocks`} today`
            : 'ready when you are'}
      </Text>

      {running ? (
        /* THE BOX CHANGES JOB WHEN THE BLOCK STARTS. The task it picked is up
           beside the clock now, so what is left is the thing a running block
           actually needs: somewhere to put the thought that just arrived.

           That is the oldest pomodoro discipline there is — you do not chase
           the thought and you do not try to hold it, you park it and carry on
           — and the app already has the place things get parked, so a jotted
           line lands in the Inbox exactly as one typed on that tab would.

           An inline field here, not a panel: the deck refuses the keyboard for
           the PICKER because a picker needs a list and a list needs a page. A
           jot needs neither. Sending you to another page to write one word is
           the interruption the whole idea exists to avoid. */
        <View style={[styles.assign, { backgroundColor: pal.field, borderColor: pal.edge }]}>
          <Icon name="lightbulb-on-outline" size={16} color={pal.muted} />
          <AppTextInput
            style={[styles.jotInput, { color: pal.text }]}
            placeholder="Park a thought for later…"
            placeholderTextColor={pal.muted}
            value={jot}
            onChangeText={setJot}
            autoCapitalize="sentences"
            returnKeyType="done"
            blurOnSubmit={false}
            onSubmitEditing={sendJot}
            accessibilityLabel="Park a thought in your inbox"
            testID="focus-jot-input"
          />
          <Pressable
            onPressIn={() => tapHaptic()}
            onPress={sendJot}
            // Disabled rather than hidden: a key that appears as you type is a
            // key you cannot aim for.
            disabled={!jot.trim()}
            accessibilityRole="button"
            accessibilityState={{ disabled: !jot.trim() }}
            accessibilityLabel="Park this thought"
            hitSlop={8}
            testID="focus-jot-send"
            style={({ pressed }) => [styles.jotKey, pressed && styles.pressed]}
          >
            <Icon name="arrow-down" size={16} color={jot.trim() ? pal.text : pal.muted} />
          </Pressable>
        </View>
      ) : (
        /* Idle, it is the picker: a search field in SHAPE — rounded, a
           magnifier, muted placeholder — and not in behaviour, because it opens
           the picker rather than taking the keyboard here. */
        <Pressable
          onPressIn={() => tapHaptic()}
          onPress={onPickTask}
          accessibilityRole="button"
          accessibilityLabel={task ? `Focusing on ${task.title}. Change the task.` : 'Pick a task for this session'}
          testID="focus-assign"
          style={({ pressed }) => [
            styles.assign,
            { backgroundColor: pal.tile, borderColor: pal.edge },
            pressed && styles.pressed,
          ]}
        >
          <Icon name="magnify" size={16} color={pal.muted} />
          <Text
            style={[styles.assignText, { color: task ? pal.text : pal.muted }]}
            numberOfLines={1}
            testID="focus-assign-label"
          >
            {task ? task.title : 'Pick a task…'}
          </Text>
          {task ? (
            /* Clearing is its own target, not a second meaning for the row: the
               row changes the task, this takes it away. A block with no task is
               a perfectly good block — the deck counts either. */
            <Pressable
              onPressIn={() => tapHaptic()}
              onPress={onClearTask}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Focus without a task"
              testID="focus-assign-clear"
            >
              <Icon name="close-circle" size={16} color={pal.muted} />
            </Pressable>
          ) : null}
        </Pressable>
      )}

      {/* THE TWO WAYS IN, side by side and the same size, because they are two
          halves of one cycle rather than an action and its lesser sibling. The
          break is the OUTLINE key: both are one tap, but only one of them is
          what the page is for.

          Running, they collapse to a single Stop. Offering "start" keys under a
          live block would be offering to start a second one — the pond allows
          exactly one, so the second would silently cancel the first. */}
      {running ? (
        <Pressable
          onPressIn={() => tapHaptic()}
          onPress={onStop}
          accessibilityRole="button"
          accessibilityLabel={isBreak ? 'Stop the break' : 'Stop the focus block'}
          testID="focus-toggle"
          style={({ pressed }) => [
            styles.key, styles.keyWide,
            { backgroundColor: 'transparent', borderColor: pal.edge },
            pressed && styles.pressed,
          ]}
        >
          <Icon name="stop" size={15} color={pal.text} />
          <Text style={[styles.keyText, { color: pal.text }]}>Stop</Text>
        </Pressable>
      ) : (
        <View style={styles.keyRow}>
          <Pressable
            onPressIn={() => tapHaptic()}
            onPress={onStartBreak}
            accessibilityRole="button"
            accessibilityLabel="Start a break"
            testID="focus-start-break"
            style={({ pressed }) => [
              styles.key, styles.keyHalf,
              { backgroundColor: 'transparent', borderColor: pal.edge },
              pressed && styles.pressed,
            ]}
          >
            <Icon name="coffee-outline" size={15} color={pal.text} />
            <Text style={[styles.keyText, { color: pal.text }]} numberOfLines={1}>Start break</Text>
          </Pressable>
          <Pressable
            onPressIn={() => impactHaptic('medium')}
            onPress={onStartFocus}
            accessibilityRole="button"
            accessibilityLabel={task ? `Start a focus session on ${task.title}` : 'Start a focus session'}
            testID="focus-toggle"
            style={({ pressed }) => [
              styles.key, styles.keyHalf,
              { backgroundColor: pal.text, borderColor: pal.text },
              pressed && styles.pressed,
            ]}
          >
            <Icon name="play" size={15} color={pal.onText} />
            <Text style={[styles.keyText, { color: pal.onText }]} numberOfLines={1}>Start session</Text>
          </Pressable>
        </View>
      )}
    </Animated.View>
  );
}

/**
 * A figure that counts up to its value rather than appearing at it.
 *
 * Over about half a second, eased out, and only when the value actually
 * CHANGES — a tile that re-animates on every unrelated re-render is a tile
 * that never sits still. Driven by rAF rather than an Animated listener: the
 * number has to be rendered as text, so it costs a render per frame either
 * way, and a handful of tiles for half a second is nothing next to the
 * machinery a listener would need.
 */
function useCountUp(value, ms = 520) {
  const target = Number(value) || 0;
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    if (start === target) { setShown(target); return undefined; }
    let raf = null;
    const t0 = Date.now();
    const step = () => {
      const t = Math.min(1, (Date.now() - t0) / ms);
      // Ease-out cubic: fast off the mark, settling into the figure.
      const e = 1 - (1 - t) ** 3;
      setShown(Math.round(start + (target - start) * e));
      if (t < 1) raf = requestAnimationFrame(step);
      else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => { if (raf) cancelAnimationFrame(raf); from.current = target; };
  }, [target, ms]);
  return shown;
}

/**
 * A stat tile. `count` is the number BEHIND the text — given one, the tile
 * counts up to it and `format` turns each step into what you read, so "1h 05m"
 * climbs as honestly as "65" would.
 */
function Tile({ icon, label, count, format, value, caption, pal, accent, enter, testID }) {
  const shown = useCountUp(count ?? 0);
  const text = count == null ? value : (format ? format(shown) : String(shown));
  return (
    <Animated.View
      style={[
        styles.tile,
        { backgroundColor: pal.card, borderColor: pal.edge, borderTopColor: pal.edgeTop },
        enter,
      ]}
      testID={testID}
    >
      <View style={styles.tileTop}>
        <View style={[styles.iconTile, { backgroundColor: pal.tile }]}>
          <Icon name={icon} size={15} color={accent || pal.text} />
        </View>
        <Text style={[styles.label, { color: pal.muted }]} numberOfLines={1}>{label}</Text>
      </View>
      <Text style={[styles.value, { color: accent || pal.text }]} numberOfLines={1}>{text}</Text>
      <Text style={[styles.caption, { color: pal.muted }]} numberOfLines={1}>{caption}</Text>
    </Animated.View>
  );
}

/**
 * When in the day the focus happened — 24 cells, one per hour, inked by how
 * much. The night hours are kept rather than trimmed: an empty 3am is part of
 * the shape, and a strip that started at your earliest block would rescale
 * itself every time you had an unusual morning.
 */
function HourStrip({ byHour, pal, accent }) {
  const peak = Math.max(1, ...byHour);
  return (
    <View testID="focus-hour-strip">
      <View style={styles.hours}>
        {byHour.map((m, h) => (
          <View
            key={h}
            style={[
              styles.hourCell,
              {
                backgroundColor: m > 0 ? accent : pal.track,
                // Floor at a fifth: an hour with any focus at all must be
                // visibly different from one with none, however small a share
                // of the peak it is.
                opacity: m > 0 ? Math.max(0.2, m / peak) : 1,
              },
            ]}
          />
        ))}
      </View>
      <View style={styles.hourScale}>
        {['12a', '6a', '12p', '6p', '11p'].map((t) => (
          <Text key={t} style={[styles.hourTick, { color: pal.muted }]}>{t}</Text>
        ))}
      </View>
    </View>
  );
}

/**
 * The week, as bars. Heights are a proportion of the best day, so the chart
 * reads as "how this week went" rather than as an absolute scale nobody can
 * calibrate — and a day with nothing still draws its baseline, because the
 * gaps are the part worth seeing.
 */
function WeekBars({ week, pal, accent, todayKey, pickedKey, onPick }) {
  const peak = Math.max(1, ...week.map((d) => d.minutes));
  return (
    <View style={styles.bars} testID="focus-week-bars">
      {week.map((d) => {
        const isToday = d.key === todayKey;
        const isPicked = d.key === pickedKey;
        const h = Math.max(2, Math.round((d.minutes / peak) * 64));
        const dow = new Date(d.ms).toLocaleDateString('en-US', { weekday: 'narrow' });
        return (
          <Pressable
            key={d.key}
            onPress={() => onPick?.(d.key)}
            style={styles.barCol}
            accessibilityRole="button"
            accessibilityLabel={`${dow}, ${d.minutes} minutes`}
            testID={`focus-bar-${d.key}`}
          >
            <View style={styles.barSlot}>
              <View
                style={[
                  styles.bar,
                  {
                    height: h,
                    backgroundColor: d.minutes === 0 ? pal.track : (isToday || isPicked ? accent : pal.text),
                    opacity: d.minutes === 0 ? 1 : (isToday || isPicked ? 1 : 0.55),
                  },
                ]}
              />
            </View>
            <Text
              style={[styles.barLabel, { color: (isToday || isPicked) ? pal.text : pal.muted }]}
              numberOfLines={1}
            >
              {dow}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function FocusPage({
  // GET /pomodoros, as the screen already fetches it.
  sessions,
  // { taskId, endsAt, startedAt, durationMinutes, mode } | null — the block
  // running right now. `mode` is 'focus' or 'break'; both drive this deck.
  active,
  // The planned length of a fresh block, in minutes.
  focusMinutes = 25,
  // (taskId) => board name — so the page can say where the focus went.
  boardOfTask,
  // (taskId) => task | null — so a recent block can NAME what it was for, and
  // so a block whose task has since been deleted stops offering to resume it.
  // Resolved by the screen, like boardOfTask: the log rows carry only an id.
  taskOfId,
  // (task) => void — start a fresh session on the task a recent block was for.
  onResumeBlock,
  // The task the next session is FOR, or null for a loose block. Resolved by
  // the screen so it follows edits and so a block started elsewhere shows the
  // task it was actually started on.
  focusTask,
  // Open the picker / drop the task.
  onPickTask,
  onClearTask,
  // (line) => void — park a thought while a block runs. It lands wherever the
  // Inbox tab's own capture lands.
  onJot,
  // Start a focus session, start a break, stop whichever is running.
  onStart,
  onStartBreak,
  onStop,
  theme,
  bottomInset = 0,
  // Injected in tests; the page is otherwise a clock and would be untestable.
  nowMs,
}) {
  // Every surface on this page is an inset CARD, so the card palette is the
  // whole palette — nothing here draws its ink straight onto the page, which is
  // the mistake that made the old ring's readout white on white in light mode.
  const pal = useMemo(() => insetCardPalette(theme), [theme]);
  const accent = theme.colors.accentInfo || theme.colors.textPrimary;
  // The break's own colour, and the chat timer card's exactly (TimerMessage):
  // the same two modes wearing the same two colours wherever they are shown.
  const breakAccent = theme.colors.accentSuccess || '#4ECDC4';
  const now = nowMs ?? Date.now();
  const stats = useMemo(() => focusStats(sessions, now, boardOfTask), [sessions, now, boardOfTask]);

  const running = !!active && active.endsAt > now;
  // The visible countdown, ticked locally from the absolute end stamp — the
  // same contract the chat's timer card uses. One interval, only while a block
  // is actually running.
  const [remaining, setRemaining] = useState(() => (running ? active.endsAt - now : 0));
  useEffect(() => {
    if (!running) { setRemaining(0); return undefined; }
    setRemaining(active.endsAt - Date.now());
    const id = setInterval(() => {
      const left = active.endsAt - Date.now();
      setRemaining(left > 0 ? left : 0);
    }, 1000);
    return () => clearInterval(id);
  }, [running, active?.endsAt]);

  // ── The motion ────────────────────────────────────────────────────────────
  const progress = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  const breath = useRef(null);

  // The sweep. Driven from the block's OWN clock rather than ticked: one
  // timing animation from wherever we are now to the end, so it is smooth
  // between the per-second re-renders instead of stepping with them.
  useEffect(() => {
    if (!running) { progress.setValue(0); return undefined; }
    const total = Math.max(1, (active.durationMinutes || focusMinutes) * 60000);
    const done = Math.min(1, Math.max(0, (Date.now() - active.startedAt) / total));
    progress.setValue(done);
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: Math.max(0, active.endsAt - Date.now()),
      easing: Easing.linear,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [running, active?.startedAt, active?.endsAt, active?.durationMinutes, focusMinutes, progress]);

  // The breath, and the two one-shots either side of a block.
  useEffect(() => {
    breath.current?.stop();
    if (!running) { pulse.setValue(1); return undefined; }
    // START: one firm pulse out, then settle into the breath.
    const kick = Animated.sequence([
      Animated.timing(pulse, { toValue: KICK_TO, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.spring(pulse, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true }),
    ]);
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: BREATH_TO, duration: BREATH_MS / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: BREATH_MS / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    breath.current = Animated.sequence([kick, loop]);
    breath.current.start();
    return () => breath.current?.stop();
  }, [running, pulse]);

  // END: the bloom, the haptic and the chime. Fired on the TRANSITION out of
  // running, not on every render where nothing is running — otherwise arriving
  // on this tab would play the ending of a block you never started.
  //
  // THREE THINGS HAVE TO BE TRUE, and each rules out a different wrong ding:
  //   · it was running a moment ago      — not a cold arrival on the page;
  //   · the clock actually reached zero  — a block you STOPPED early is not a
  //     block you finished, and celebrating it would be reading the room
  //     exactly wrong;
  //   · it reached zero JUST NOW         — timers are frozen while the app is
  //     suspended, so without this the chime would go off on resume for a
  //     block that ended in another hour of the day.
  //
  // The end stamp is held in a ref because `active` is already null by the time
  // the transition is observed: the very thing that ended the block is the thing
  // that took away the object carrying its end time.
  const lastEndsAt = useRef(null);
  useEffect(() => { if (running) lastEndsAt.current = active.endsAt; }, [running, active?.endsAt]);

  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running) {
      const endsAt = lastEndsAt.current;
      const since = typeof endsAt === 'number' ? Date.now() - endsAt : null;
      // A second of slack at the near edge: the tick that notices the end lands
      // up to a second after it.
      const ranOut = since != null && since > -1000 && since < FRESH_MS;
      if (ranOut) {
        notifyHaptic('success');
        playFocusComplete();
        pulse.setValue(1);
        Animated.sequence([
          Animated.timing(pulse, { toValue: BLOOM_TO, duration: 260, easing: Easing.out(Easing.back(2)), useNativeDriver: true }),
          Animated.spring(pulse, { toValue: 1, friction: 6, tension: 90, useNativeDriver: true }),
        ]).start();
      } else {
        // Stopped early, or noticed late. The deck simply goes back to idle.
        pulse.setValue(1);
      }
    }
    wasRunning.current = running;
  }, [running, pulse]);

  const todayKey = stats.week.length ? stats.week[stats.week.length - 1].key : null;

  // A day picked off the week chart. The bars stop being a picture and start
  // being something you can interrogate — which is the difference between a
  // chart and a decoration.
  const [pickedDay, setPickedDay] = useState(null);
  const picked = pickedDay ? stats.week.find((d) => d.key === pickedDay) : null;

  // ── The way into the longer view ──────────────────────────────────────────
  // Four keys, each the total for its period and the way into that period's
  // charts. The figures are useful standing still — "this month: 6h 40m" is
  // worth knowing without opening anything — and they make the keys honest
  // about what is behind them.
  const summaries = useMemo(() => rangeSummaries(sessions, now), [sessions, now]);
  // Which period's panel is open, or null. Holding the RANGE rather than a
  // boolean is what lets four keys share one panel.
  const [statsRange, setStatsRange] = useState(null);
  const insets = useSafeAreaInsets();

  // ── The entrance ──────────────────────────────────────────────────────────
  // The page's sections arrive in order rather than all at once. A stagger
  // reads as the page assembling itself; everything appearing on one frame
  // reads as a screenshot. Once only — it is an arrival, not a transition, and
  // replaying it on every re-render would make the page twitch.
  const entry = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(entry, {
      toValue: 1,
      duration: 620,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [entry]);
  // Each section takes its slice of the same value, so one animation drives
  // the whole cascade and there is nothing to keep in step.
  const enterAt = (from, to) => ({
    opacity: entry.interpolate({ inputRange: [from, to], outputRange: [0, 1], extrapolate: 'clamp' }),
    transform: [{
      translateY: entry.interpolate({ inputRange: [from, to], outputRange: [14, 0], extrapolate: 'clamp' }),
    }],
  });

  return (
    <View style={styles.root}>
    <ScrollView
      style={styles.page}
      contentContainerStyle={[styles.body, { paddingBottom: 32 + bottomInset }]}
      showsVerticalScrollIndicator={false}
      testID="focus-page"
    >
      {/* The countdown, the bar, and the one control that matters. */}
      <FocusDeck
        running={running}
        remaining={remaining}
        focusMinutes={focusMinutes}
        block={active}
        todaySessions={stats.todaySessions}
        progress={progress}
        pulse={pulse}
        pal={pal}
        accent={accent}
        breakAccent={breakAccent}
        task={focusTask}
        onPickTask={onPickTask}
        onClearTask={onClearTask}
        onJot={onJot}
        onStartFocus={() => onStart?.()}
        onStartBreak={() => onStartBreak?.()}
        onStop={() => onStop?.()}
      />

      <View style={styles.tiles}>
        <Tile
          icon="timer-outline"
          label="Today"
          count={stats.todayMinutes}
          format={formatMinutes}
          caption={stats.todaySessions === 1 ? '1 block' : `${stats.todaySessions} blocks`}
          pal={pal}
          enter={enterAt(0, 0.35)}
          testID="focus-tile-today"
        />
        <Tile
          icon="calendar-week"
          label="This week"
          count={stats.weekMinutes}
          format={formatMinutes}
          caption="last 7 days"
          pal={pal}
          enter={enterAt(0.08, 0.45)}
          testID="focus-tile-week"
        />
        <Tile
          icon="fire"
          label="Streak"
          value={stats.streak ? `${stats.streak}d` : '—'}
          caption={stats.streak ? 'days running' : 'start one today'}
          pal={pal}
          accent={stats.streak >= 3 ? '#F59E0B' : null}
          enter={enterAt(0.16, 0.55)}
          testID="focus-tile-streak"
        />
        <Tile
          icon="chart-donut"
          label="Average"
          value={stats.averageMinutes ? `${stats.averageMinutes}m` : '—'}
          caption={stats.totalSessions === 1 ? 'over 1 block' : `over ${stats.totalSessions} blocks`}
          pal={pal}
          enter={enterAt(0.24, 0.65)}
          testID="focus-tile-average"
        />
      </View>

      <Text style={[styles.section, { color: theme.colors.textTertiary }]}>
        The week{picked ? ` · ${new Date(picked.ms).toLocaleDateString('en-US', { weekday: 'long' })}, ${formatMinutes(picked.minutes)}` : ''}
      </Text>
      <Animated.View
        style={[styles.panel, { backgroundColor: pal.card, borderColor: pal.edge, borderTopColor: pal.edgeTop }, enterAt(0.3, 0.7)]}
      >
        <WeekBars
          week={stats.week}
          pal={pal}
          accent={accent}
          todayKey={todayKey}
          pickedKey={pickedDay}
          onPick={(key) => { tapHaptic(); setPickedDay((k) => (k === key ? null : key)); }}
        />
      </Animated.View>

      {/* The longer view. Four keys rather than four more charts crammed onto
          this page: a month's shape needs the width, and the page's job is the
          ring and today. Each key is its period's total AND the door to that
          period's charts. */}
      <Text style={[styles.section, { color: theme.colors.textTertiary }]}>Stats</Text>
      <Animated.View style={[styles.tiles, enterAt(0.34, 0.74)]}>
        {summaries.map((r) => (
          <Pressable
            key={r.range}
            onPressIn={() => tapHaptic()}
            onPress={() => setStatsRange(r.range)}
            accessibilityRole="button"
            accessibilityLabel={`${r.title}, ${formatMinutes(r.minutes)} of focus. Open the stats.`}
            testID={`focus-stats-key-${r.range}`}
            style={({ pressed }) => [
              styles.statKey,
              { backgroundColor: pal.card, borderColor: pal.edge, borderTopColor: pal.edgeTop },
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.statKeyTop}>
              <Text style={[styles.label, { color: pal.muted }]} numberOfLines={1}>{r.title}</Text>
              <Icon name="chevron-right" size={15} color={pal.muted} />
            </View>
            <Text style={[styles.statKeyValue, { color: pal.text }]} numberOfLines={1}>
              {r.minutes ? formatMinutes(r.minutes) : '—'}
            </Text>
            <Text style={[styles.caption, { color: pal.muted }]} numberOfLines={1}>
              {r.blocks === 0
                ? (r.label || 'nothing yet')
                : `${r.blocks === 1 ? '1 block' : `${r.blocks} blocks`}${r.label ? ` · ${r.label}` : ''}`}
            </Text>
          </Pressable>
        ))}
      </Animated.View>

      {/* WHEN, as opposed to how much — the question the totals cannot answer
          and the one that actually changes what you do tomorrow. */}
      <Text style={[styles.section, { color: theme.colors.textTertiary }]}>
        When you focus{stats.best ? ` · best ${formatMinutes(stats.best.minutes)}` : ''}
      </Text>
      <Animated.View
        style={[styles.panel, { backgroundColor: pal.card, borderColor: pal.edge, borderTopColor: pal.edgeTop }, enterAt(0.38, 0.78)]}
      >
        <HourStrip byHour={stats.byHour} pal={pal} accent={accent} />
      </Animated.View>

      {/* RECENT BLOCKS — the page's one piece of detail, and the only place a
          single session is visible as itself.

          IT IS A CARD, like everything else here. It used to be bare rows laid
          straight onto the page while taking their ink from the inset-card
          palette — whose text is WHITE IN BOTH MODES (see the note at the top of
          this file). On the light page that is white type on cream: the whole
          list was there and none of it could be read. The fix is the card, not a
          second set of colours — every other surface on this page already is
          one, and nothing on this page draws its ink straight onto the page.

          And they RESUME. A block that names a task is a record of work you can
          pick up again, so tapping it starts a fresh session on that task — the
          shortest path back to what you were doing, which is the thing a list of
          recent work is FOR. A block with no task (or whose task has since been
          deleted) has nothing to resume, so it stays a plain row rather than
          offering a key that would do nothing. */}
      {stats.recent.length > 0 && (
        <>
          <Text style={[styles.section, { color: theme.colors.textTertiary }]}>Recent blocks</Text>
          <Animated.View
            style={[
              styles.panel,
              styles.recentPanel,
              { backgroundColor: pal.card, borderColor: pal.edge, borderTopColor: pal.edgeTop },
              enterAt(0.46, 0.86),
            ]}
            testID="focus-recent-panel"
          >
            {stats.recent.map((r, i) => {
              const task = r.taskId ? (taskOfId?.(r.taskId) || null) : null;
              // What the block was: its task if we can still name one, otherwise
              // the board it counted towards. The task is the more useful of the
              // two here — it is what the tap would resume — and the board has a
              // whole section of its own below.
              const what = (task?.title || '').trim() || (r.board ? boardLabel(r.board) : 'No Board');
              const last = i === stats.recent.length - 1;
              return (
                <Pressable
                  key={r.id}
                  disabled={!task}
                  onPressIn={task ? () => tapHaptic() : undefined}
                  onPress={task ? () => onResumeBlock?.(task) : undefined}
                  accessibilityRole={task ? 'button' : undefined}
                  accessibilityLabel={task ? `Resume ${what}` : undefined}
                  style={({ pressed }) => [
                    styles.recentRow,
                    // No rule under the last row: inside a card the divider
                    // between rows is a divider, but one at the foot is a line
                    // drawn across the card for no reason.
                    !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: pal.edge },
                    pressed && styles.pressed,
                  ]}
                  testID={`focus-recent-${r.id}`}
                >
                  <View style={[styles.recentDot, { backgroundColor: accent }]} />
                  <Text style={[styles.recentWhen, { color: pal.text }]} numberOfLines={1}>
                    {new Date(r.startedAt).toLocaleDateString('en-US', { weekday: 'short' })}
                    {' · '}
                    {new Date(r.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </Text>
                  <Text
                    style={[styles.recentWhat, { color: task ? pal.sub : pal.muted }]}
                    numberOfLines={1}
                  >
                    {what}
                  </Text>
                  <Text style={[styles.recentMins, { color: pal.text }]} numberOfLines={1}>{r.minutes}m</Text>
                  {/* The key, and the whole signal that the row is one. The slot
                      is held even when there is nothing to resume, so the minute
                      figures above it stay in a column. */}
                  <View style={styles.recentKey} testID={task ? `focus-resume-${r.id}` : undefined}>
                    {!!task && <Icon name="replay" size={15} color={accent} />}
                  </View>
                </Pressable>
              );
            })}
          </Animated.View>
        </>
      )}

      <Text style={[styles.section, { color: theme.colors.textTertiary }]}>Where it went</Text>
      {stats.boards.length === 0 ? (
        <Text style={[styles.empty, { color: pal.muted }]}>No focus blocks yet. Start one above.</Text>
      ) : stats.boards.map((b) => {
        const share = stats.totalMinutes ? b.minutes / stats.totalMinutes : 0;
        return (
          <View
            key={b.name}
            style={[styles.row, { backgroundColor: pal.card, borderColor: pal.edge, borderTopColor: pal.edgeTop }]}
            testID={`focus-board-${b.name}`}
          >
            <View style={styles.rowTop}>
              <Text style={[styles.rowName, { color: pal.text }]} numberOfLines={1}>{boardLabel(b.name)}</Text>
              <Text style={[styles.rowFigure, { color: pal.text }]} numberOfLines={1}>{formatMinutes(b.minutes)}</Text>
            </View>
            <Text style={[styles.rowCaption, { color: pal.muted }]} numberOfLines={1}>
              {b.sessions === 1 ? '1 block' : `${b.sessions} blocks`} · {Math.round(share * 100)}%
            </Text>
            <View style={[styles.track, { backgroundColor: pal.track }]}>
              <View style={[styles.fill, { width: `${Math.round(share * 100)}%`, backgroundColor: pal.text }]} />
            </View>
          </View>
        );
      })}

      {stats.abandoned > 0 && (
        <Text style={[styles.footnote, { color: pal.muted }]} testID="focus-abandoned">
          {stats.abandoned === 1 ? '1 block' : `${stats.abandoned} blocks`} started and left — not counted above.
        </Text>
      )}
    </ScrollView>

    {/* The period's charts, as a pushed page. The Modal form rather than the
        in-tree overlay: this page sits in the Tasks pager, not inside another
        EdgeSwipePage, so it is a top-level page over a tab (see the note on
        EdgeSwipePage's `overlay` prop). A Modal also escapes the pager, which
        an absolute child could not — it would scroll away sideways with the
        page it was pinned to. */}
    <EdgeSwipePage visible={!!statsRange} onClose={() => setStatsRange(null)}>
      {!!statsRange && (
        <FocusStatsPanel
          sessions={sessions}
          boardOfTask={boardOfTask}
          pal={pal}
          theme={theme}
          initialRange={statsRange}
          onClose={() => setStatsRange(null)}
          insetTop={insets.top}
          bottomInset={Math.max(insets.bottom, bottomInset)}
          nowMs={nowMs}
        />
      )}
    </EdgeSwipePage>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  page: { flex: 1 },
  body: { paddingHorizontal: 16, paddingTop: 4, gap: 10 },
  // The deck. The same inset card as the tiles below it, one size up: this is
  // the page's subject, so it gets the top of the screen and the big reading.
  deck: { marginTop: 6, borderRadius: 16, borderWidth: 1, padding: 14, gap: 10 },
  deckHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  deckMeta: { fontSize: 11.5 },
  // The task row. A search field's shape — rounded, a magnifier, muted
  // placeholder ink — sitting on the card's own tile colour so it reads as a
  // field rather than as another key.
  assign: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    height: 36, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
  },
  assignText: { flex: 1, fontSize: 13.5 },
  // The single-line field metrics this app uses everywhere: no height of its
  // own inside a fixed-height row, Android's reserved font padding off.
  jotInput: {
    flex: 1,
    fontSize: 13.5,
    paddingVertical: 0,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  jotKey: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  // Tabular figures so the reading does not shuffle as the digits change, and
  // light: this is a big number that has to sit quietly for 25 minutes.
  // The reading and what it is FOR, on one line. Top-aligned rather than
  // centred: a task that wraps to three lines should hang from the clock's
  // cap-height, not push the clock down the card.
  clockRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  clock: { fontSize: 42, fontWeight: '200', letterSpacing: 0.5, fontVariant: ['tabular-nums'] },
  // Thin, and it wraps. A truncated task name is the one thing on this deck
  // that cannot be inferred from anything else on it.
  runTask: { flex: 1, fontSize: 14.5, lineHeight: 19, fontWeight: '200', paddingTop: 8 },
  deckNote: { fontSize: 11.5 },

  // The bar. The chat timer card's proportions, a hair taller because this one
  // is the page's subject rather than a line in a conversation.
  barTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  // Full width and SCALED from the left, so the fill rides the native driver.
  barFill: { ...StyleSheet.absoluteFillObject, borderRadius: 3, transformOrigin: 'left' },

  // The two keys. Same height, same radius, same type — halves of one cycle,
  // so nothing about their SHAPE says one is the lesser. Only the fill does.
  keyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  key: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    paddingHorizontal: 14, height: 40, borderRadius: 20, borderWidth: 1,
  },
  keyHalf: { flex: 1 },
  keyWide: { alignSelf: 'stretch' },
  keyText: { flexShrink: 1, fontSize: 13.5, fontWeight: '800', letterSpacing: 0.2 },
  pressed: { opacity: 0.75 },

  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { flexGrow: 1, flexBasis: '47%', borderRadius: 14, borderWidth: 1, padding: 12, gap: 2 },
  tileTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconTile: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.9, textTransform: 'uppercase' },
  value: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5, marginTop: 4 },
  caption: { fontSize: 11.5 },

  // The four period keys. The same inset card and the same two-up grid as the
  // tiles above them, so the page reads as one set of furniture rather than
  // two — the chevron is what says this one opens.
  statKey: { flexGrow: 1, flexBasis: '47%', borderRadius: 14, borderWidth: 1, padding: 12, gap: 2 },
  statKeyTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statKeyValue: { fontSize: 20, fontWeight: '800', letterSpacing: -0.5, marginTop: 4 },

  section: { fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginTop: 8 },
  panel: { borderRadius: 14, borderWidth: 1, padding: 14 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 6 },
  barCol: { flex: 1, alignItems: 'center', gap: 6 },
  barSlot: { height: 64, justifyContent: 'flex-end' },
  bar: { width: 18, borderRadius: 4 },
  barLabel: { fontSize: 10, fontWeight: '700' },

  // The 24-hour strip. Cells share the row equally and keep a hairline gap, so
  // the shape reads as a bar chart of the day rather than a gradient.
  hours: { flexDirection: 'row', gap: 2, height: 26 },
  hourCell: { flex: 1, borderRadius: 2 },
  hourScale: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  hourTick: { fontSize: 9.5, fontWeight: '700' },

  // The card holds the rows, so its own padding is vertical only — each row
  // takes the full width and carries the side inset itself, which is what lets
  // a press highlight run edge to edge instead of floating inside a margin.
  recentPanel: { paddingVertical: 2, paddingHorizontal: 0 },
  recentRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 9, paddingHorizontal: 14,
  },
  recentDot: { width: 6, height: 6, borderRadius: 3 },
  recentWhen: { fontSize: 12.5, fontWeight: '700', fontVariant: ['tabular-nums'] },
  // What the block was — the task, or the board it counted towards. Takes the
  // room the fixed columns either side do not need, and ellipsizes rather than
  // pushing the minutes off the card (STYLE-RULES §2).
  recentWhat: { flex: 1, fontSize: 12, textAlign: 'right' },
  recentMins: { fontSize: 12.5, fontWeight: '800', fontVariant: ['tabular-nums'], minWidth: 34, textAlign: 'right' },
  recentKey: { width: 16, alignItems: 'center', justifyContent: 'center' },

  row: { borderRadius: 14, borderWidth: 1, padding: 12, gap: 6 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowName: { flex: 1, fontSize: 14, fontWeight: '700' },
  rowFigure: { fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  rowCaption: { fontSize: 11.5 },
  track: { height: 3, borderRadius: 2, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 2 },
  empty: { fontSize: 13, paddingVertical: 6 },
  footnote: { fontSize: 11.5, marginTop: 6 },
});

export default memo(FocusPage);
