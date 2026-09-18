/**
 * ScheduleCard — the day panel's task row: the TIME on the left, a soft
 * tinted card on the right (docs/STYLE-RULES.md §1, "schedule cards").
 *
 * Reads like a planner page: a light column of clock labels, then a card
 * washed in the board's colour (pastel on the light page, a deeper tint on
 * the dark one) carrying the title, the board name, a completion ring and
 * the time range bottom-right. Nothing else — the details live one tap away
 * in the inspector. Untimed rows keep the same shape with a quiet label in
 * the time column so the eye scans one straight edge.
 */
import React, { memo, useEffect, useMemo, useState } from 'react';
import { PixelRatio, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { tapHaptic, impactHaptic } from '../../../utils/haptics';
import { boardLabel } from '../utils/taskHelpers';

/** "08 AM" / "08:30 AM" (or "08:30" in 24 h) for a minutes-since-midnight value. */
export function clockLabel(minutes, use24h = false, { pad = true } = {}) {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  const mm = String(m).padStart(2, '0');
  if (use24h) return `${String(h).padStart(2, '0')}:${mm}`;
  const ap = h >= 12 ? 'PM' : 'AM';
  // `pad` off drops the leading zero — "3:30 PM", not "03:30 PM". Two
  // characters, but they are the two that overflowed the timeline's 56pt
  // gutter and left "03:30…" on screen. The gutter is narrow BECAUSE the
  // expanded grid only ever prints whole hours, which its own formatter
  // writes unpadded ("3 PM") — so unpadded is also the form that matches it.
  const hour = String(h % 12 || 12);
  const h12 = pad ? hour.padStart(2, '0') : hour;
  return m ? `${h12}:${mm} ${ap}` : `${h12} ${ap}`;
}

/**
 * Minutes left on a running focus block, or null when nothing is running.
 *
 * Rounded UP, and never below 1 while the block is live: a timer that reads
 * "0" for the last 59 seconds looks finished when it is not. It flips to null
 * only once the end has actually passed, which is when the key goes back to
 * being the button that starts one.
 */
export function minutesLeft(endsAt, now = Date.now()) {
  const end = Number(endsAt);
  if (!Number.isFinite(end) || end <= now) return null;
  return Math.max(1, Math.ceil((end - now) / 60000));
}

/**
 * How much of a running block is still to run, 0–100, or null when nothing is
 * running — the LEVEL the live key drains through as the block burns down.
 *
 * Needs the block's LENGTH, which comes either as `durationMinutes` or as the
 * distance from `startedAt` to `endsAt`. Given neither, this is null and the
 * key still counts down in numbers; the gauge is the part that needs to know
 * how long the block was to begin with.
 *
 * Floored at 4 so a live block always shows a sliver of level, for the same
 * reason `minutesLeft` never reads 0: the last minute of a block is still the
 * block running, and an empty circle reads as a finished one.
 */
export function remainingPct(pomodoro, now = Date.now()) {
  const end = Number(pomodoro?.endsAt);
  if (!Number.isFinite(end) || end <= now) return null;
  const mins = Number(pomodoro?.durationMinutes);
  const started = Number(pomodoro?.startedAt);
  const span = mins > 0 ? mins * 60000 : (Number.isFinite(started) ? end - started : 0);
  if (!(span > 0)) return null;
  return Math.max(4, Math.min(100, Math.round(((end - now) / span) * 100)));
}

/** A #RRGGBB colour at `alpha` (0–1); anything else falls back to `fallback`. */
export function tintOf(hex, alpha, fallback) {
  if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) return fallback;
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}

function ScheduleCard({
  task, timeLabel, range, color, done, theme, onPress, onLongPress, onToggle, trailing, subtitle, testID,
  // Everyone on this task — the owner first, then whoever else is involved.
  // [{ id, name, color, avatarUrl, … }]. Empty on a solo task, which draws no
  // badges at all.
  people = [],
  // { endsAt, count, startedAt, durationMinutes } — a running focus block's end
  // (so the circle can count it down), its length (so the circle can also show
  // how much of it is left as a level), and how many blocks the task has had.
  pomodoro,
  // (people, task, anchor) — the stack is ONE target that opens a list of
  // everyone on the task, rather than each disc opening its own profile: at a
  // third of a disc apiece the faces overlap too much to aim at, and the list
  // is where the basic info about each of them belongs anyway. `anchor` is the
  // stack's rect in window coordinates, so the list can drop from it.
  onPeoplePress,
  // Start a focus timer for this task. Draws the SECOND key, under the done
  // square — a circle, because it is a different kind of action: done is a
  // state you set, a pomodoro is a thing you start.
  onStartPomodoro,
  // Where a LIVE key goes. While a block is running on this task the circle is
  // no longer a start button — it is the block itself, counting down — so a tap
  // opens the running timer rather than starting a second one. Falls back to
  // `onStartPomodoro` when a caller hands no destination, which is still better
  // than a live key that does nothing at all.
  onOpenPomodoro,
  // Tap the time column to re-time the task. Omitted where the column carries
  // something that isn't a time (the Pending strip shows a due DATE there), so
  // the gesture only exists where it means what it looks like.
  onTimePress,
  // 0–1: where NOW falls through this card's own stretch of clock, or null when
  // the current minute is not inside it. The timeline's red now-line, carried
  // onto the one card the line would otherwise pass behind — see `nowMark`.
  nowAt,
}) {
  const c = theme.colors;
  const dark = theme.mode === 'dark';
  // No measuring: the card is a fixed height and the keys are a fixed size cut
  // from it, so every key in the app is the same as every other one.

  // The countdown re-reads itself only while something is actually running,
  // and then at whichever comes first:
  //
  //   • the next minute BOUNDARY — the NUMBER changes exactly on it, so this
  //     is scheduled to the boundary rather than every 60 s, which would drift
  //     by however late the first tick was;
  //   • RING_STEP — the RING is continuous, and a minute's wait would move it
  //     in 14° jumps.
  //
  // A per-second tick would still be 50-odd renders nobody can see. Six a
  // minute on ONE card is the whole cost: the pond keeps a single block in
  // flight, so only one key in the app is ever live.
  //
  // The last of these timeouts is also what retires the live key: it fires
  // past `endsAt`, `minutesLeft` goes null, and the circle is a start button
  // again without anyone refetching.
  const endsAt = pomodoro?.endsAt;
  const [, tick] = useState(0);
  useEffect(() => {
    if (minutesLeft(endsAt) == null) return undefined;
    const toBoundary = ((endsAt - Date.now()) % 60000) || 60000;
    const id = setTimeout(() => tick((n) => n + 1), Math.max(250, Math.min(toBoundary, RING_STEP)));
    return () => clearTimeout(id);
  });
  const minsLeft = minutesLeft(endsAt);
  // LIVE: a block is running on this task right now. The one state where the
  // second key stops being a button that starts something and becomes the
  // thing itself — so it changes colour, carries the minutes, drains a level,
  // and goes somewhere else when pressed.
  const live = minsLeft != null;
  const level = remainingPct(pomodoro);
  const openLive = onOpenPomodoro || onStartPomodoro;
  const key = keySurface(dark);
  // A FAINT wash of the card's own board colour over the grey, so the two keys
  // read as belonging to the row beside them rather than as neutral furniture
  // parked next to it. Faint is the whole point: at the card's own 18 % they
  // stopped being controls and became two more pieces of the card. Drawn UNDER
  // the sheen — the gloss is light on a surface, and light sits over colour.
  // A row with no board has no colour to borrow and simply stays grey.
  const keyTint = tintOf(color, dark ? 0.24 : 0.16, null);
  const pomoCount = Number(pomodoro?.count) || 0;
  // One dot per focus session, capped — see `focus` in the render.
  const focusDots = useMemo(
    () => Array.from({ length: Math.min(pomoCount, MAX_FOCUS_DOTS) }, (_, i) => i),
    [pomoCount],
  );
  const focusOverflow = Math.max(0, pomoCount - MAX_FOCUS_DOTS);
  const fill = tintOf(color, dark ? 0.26 : 0.18, dark ? c.surfaceElevated : c.surface);
  const title = task?.title || 'Untitled';
  const roster = Array.isArray(people) ? people.filter(Boolean) : [];
  // The anchor comes from the PRESS, not from measuring the stack.
  // `measureInWindow` is asynchronous and, when it cannot resolve a node,
  // simply never calls back — which is a tap that does nothing, the worst
  // possible failure for a button. The touch already carries window
  // coordinates, so the list drops from where the finger actually landed.
  const openPeople = (e) => {
    if (!onPeoplePress) return;
    const t = e?.nativeEvent;
    const anchor = t && Number.isFinite(t.pageX) && Number.isFinite(t.pageY)
      ? { x: t.pageX - PERSON / 2, y: t.pageY - PERSON / 2, width: PERSON, height: PERSON }
      : null;
    onPeoplePress(roster, task, anchor);
  };
  const shown = roster.slice(0, MAX_FACES);
  const overflow = roster.length - shown.length;
  // EVERY card is the same height, whatever a task happens to carry. A task
  // with no board used to drop this line and come out shorter than its
  // neighbours, so a column of cards had a ragged edge and the keys beside them
  // (sized from the measured card) came out different sizes too. A missing
  // fact is drawn as a PLACEHOLDER — the row is what keeps the card uniform,
  // and "No board" is also more use than a gap.
  const rawSub = subtitle !== undefined ? subtitle : (task?.project ? boardLabel(task.project) : '');
  const sub = String(rawSub || '').trim();
  const subMissing = !sub;
  const timeText = (
    <Text style={[styles.time, { color: c.textSecondary }]} numberOfLines={1}>{timeLabel}</Text>
  );
  const nowTop = nowMarkTop(nowAt);
  const nowRed = c.accentError || NOW_RED;
  return (
    <View style={styles.row} testID={testID}>
      {onTimePress ? (
        <Pressable
          onPressIn={() => tapHaptic()}
          onPress={() => onTimePress(task)}
          hitSlop={{ top: 10, bottom: 10, left: 12, right: 4 }}
          accessibilityRole="button"
          accessibilityLabel={`Edit the time for ${title}, currently ${timeLabel}`}
          testID={testID ? `${testID}-time` : undefined}
          style={({ pressed }) => [pressed && styles.pressed]}
        >
          {timeText}
        </Pressable>
      ) : timeText}
      <Pressable
        onPressIn={() => tapHaptic()}
        onPress={() => onPress?.(task)}
        onLongPress={() => onLongPress?.(task)}
        delayLongPress={350}
        accessibilityRole="button"
        accessibilityLabel={`${title}${sub ? `, ${sub}` : ''}${range ? `, ${range}` : ''}${done ? ', done' : ''}`}
        testID={testID ? `${testID}-card` : undefined}
        style={({ pressed }) => [styles.card, { backgroundColor: fill }, pressed && styles.pressed, done && styles.done]}
      >
        {/* NOW, passing through the card. The timeline's red line runs the full
            width of an empty hour, but a card is not empty — a bar across it
            would cut the title in half to say something the card's own time
            range already says precisely. So it is a STUB on the left edge:
            the same dot straddling the same edge, and NOW_STUB_W of bar, which
            is short of the 16 pt the title starts at. The eye follows the line
            down the gutter, sees where it enters the card, and the text is
            untouched. Placed by how far through its own span the minute is, so
            a task half done has the mark half way down its card. */}
        {nowTop != null && (
          <View
            pointerEvents="none"
            style={[styles.nowMark, { top: nowTop }]}
            testID={testID ? `${testID}-now` : undefined}
          >
            <View style={[styles.nowMarkDot, { backgroundColor: nowRed }]} />
            <View style={[styles.nowMarkBar, { backgroundColor: nowRed }]} />
          </View>
        )}
        <View style={styles.top}>
          <Text style={[styles.title, { color: c.textPrimary }, done && styles.struck]} numberOfLines={2}>{title}</Text>
        </View>
        <Text
          style={[styles.sub, { color: subMissing ? c.textMuted : c.textSecondary }, subMissing && styles.subMissing]}
          numberOfLines={1}
        >
          {subMissing ? 'No board' : sub}
        </Text>
        <View style={styles.bottom}>
          {shown.length > 0 ? (
            /* The people on this task, STACKED — each overlapping the one
               before by two thirds, so a row of them costs a third of a disc
               apiece instead of a full one. The first is on TOP (zIndex, not
               paint order): the owner is who the task belongs to, and a stack
               that buries them under whoever was added last reads backwards. */
            <TouchableOpacity
              style={styles.people}
              onPress={openPeople}
              disabled={!onPeoplePress}
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              accessibilityRole="button"
              accessibilityLabel={roster.length === 1
                ? `${roster[0].name}. Open profile`
                : `${roster.length} people on this task: ${roster.map((p) => p.name).join(', ')}. Open the list`}
              testID={testID ? `${testID}-people` : undefined}
            >
              {shown.map((p, i) => (
                <View
                  key={p.id}
                  style={[
                    styles.person,
                    { backgroundColor: p.color, zIndex: shown.length - i },
                    i > 0 && { marginLeft: -PERSON_OVERLAP },
                  ]}
                  testID={testID ? `${testID}-person-${p.id}` : undefined}
                >
                  {/* Their PICTURE when they have set one; the coloured initial
                      is the fallback, not the default. The initial stays
                      underneath either way, so a photo still loading (or one
                      that fails) shows the same disc rather than a hole. */}
                  <Text style={styles.ownerText}>{(p.name || '?').trim().charAt(0).toUpperCase()}</Text>
                  {!!p.avatarUrl && (
                    <Image
                      source={{ uri: p.avatarUrl }}
                      style={StyleSheet.absoluteFill}
                      contentFit="cover"
                      transition={120}
                      cachePolicy="memory-disk"
                      accessible={false}
                      testID={testID ? `${testID}-person-${p.id}-photo` : undefined}
                    />
                  )}
                </View>
              ))}
              {overflow > 0 && (
                /* The tail as a count. A card is not wide enough to be a team
                   list, and past a handful the discs stop being faces anyway. */
                <View
                  style={[styles.person, styles.personMore, { borderColor: c.textTertiary, marginLeft: -PERSON_OVERLAP }]}
                  testID={testID ? `${testID}-people-more` : undefined}
                >
                  <Text style={[styles.personMoreText, { color: c.textSecondary }]}>{`+${overflow}`}</Text>
                </View>
              )}
            </TouchableOpacity>
          ) : <View />}
          <View style={styles.bottomRight}>
            {trailing}
            {!!range && <Text style={[styles.range, { color: c.textTertiary }]} numberOfLines={1}>{range}</Text>}
          </View>
        </View>
        {/* FOCUS SESSIONS — how much focus this task has already had, on a line
            of its own under the faces: the name on the card's left edge, the
            count as DOTS on its right.

            Dots rather than a number because the question this answers is "has
            this had any, and roughly how much" — which you read off a row of
            marks at a glance without parsing anything. It was a "⏱ 2" wedged
            into the bottom-right corner beside the time range, where it was
            both the smallest thing on the card and the one competing hardest
            for room.
            The red is the timer key's own red, so the tally and the control
            that adds to it are visibly the same subject.
            The line appears only once there HAS been some focus. It used to be
            reserved on every card to keep the column level, which cost 20 pt of
            blank space on every untouched task; now that the card's height is a
            floor rather than a lock, an absent line costs nothing and most
            cards stay at exactly the 120 they always were. */}
        {pomoCount > 0 && (
          <View style={styles.focus}>
            <Text style={[styles.focusLabel, { color: c.textTertiary }]} numberOfLines={1}>
              {pomoCount === 1 ? 'Focus session' : 'Focus sessions'}
            </Text>
            <View style={styles.focusDots} testID={testID ? `${testID}-pomo-count` : undefined}>
              {focusDots.map((i) => (
                <View
                  key={i}
                  style={[styles.focusDot, { backgroundColor: key.red }]}
                  testID={testID ? `${testID}-focus-dot-${i}` : undefined}
                />
              ))}
              {/* Past a row's worth the dots stop being countable, so the
                  tail becomes a number — the same trick the faces use. */}
              {focusOverflow > 0 && (
                <Text
                  style={[styles.focusMore, { color: key.red }]}
                  testID={testID ? `${testID}-focus-more` : undefined}
                >
                  {`+${focusOverflow}`}
                </Text>
              )}
            </View>
          </View>
        )}
      </Pressable>
      {/* The KEY COLUMN, to the right of the card rather than inside it. The
          card is flex: 1, so it narrows by exactly what this column takes.

          DONE is a square: a state you set, and the shape the pending rows
          already use. START POMODORO is a CIRCLE underneath it: a different
          kind of action — something you begin, not something you toggle — and
          the shape difference is what stops a thumb reaching for one and
          finding the other. Both clear the 44 pt minimum (§3); the ring this
          replaced was 22. */}
      {(onToggle || onStartPomodoro || (live && openLive)) && (
        <View style={styles.keys}>
          {onToggle && (
            <TouchableOpacity
              onPressIn={() => impactHaptic('light')}
              onPress={() => onToggle(task)}
              activeOpacity={0.7}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: !!done }}
              accessibilityLabel={done ? `Mark ${title} not done` : `Mark ${title} done`}
              testID={testID ? `${testID}-done` : undefined}
              style={[
                styles.doneKey,
                // Light grey under a thin outline at rest. Done INVERTS to the
                // green — the one moment the key stops being quiet, which is
                // the point: a finished task should read from across the row.
                { backgroundColor: done ? KEY_DONE : key.fill, borderColor: done ? 'transparent' : key.edge },
              ]}
            >
              {/* The board's colour, faintly. Not on a DONE key: the mint is
                  what that one is saying, and a board wash over it only muddies
                  the single most readable state on the row. */}
              {!done && !!keyTint && (
                <View
                  pointerEvents="none"
                  style={[StyleSheet.absoluteFill, { backgroundColor: keyTint }]}
                  testID={testID ? `${testID}-done-tint` : undefined}
                />
              )}
              {/* The gloss belongs to a key that is WAITING to be pressed. On
                  the green it would only wash the one colour on the row that
                  is meant to carry. */}
              {!done && <KeySheen colors={key.sheen} testID={testID ? `${testID}-done-sheen` : undefined} />}
              <Icon
                name="check"
                size={KEY_GLYPH}
                color={done ? '#FFFFFF' : key.green}
                testID={testID ? `${testID}-done-check` : undefined}
              />
            </TouchableOpacity>
          )}
          {/* A LIVE block draws the key even where no start handler was given:
              a read-only row still wants to say a timer is running on this
              task. */}
          {(onStartPomodoro || (live && openLive)) && (
            <TouchableOpacity
              onPressIn={() => impactHaptic(live ? 'light' : 'medium')}
              onPress={() => (live ? openLive?.(task) : onStartPomodoro?.(task))}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={live
                ? `Focus block running on ${title}, ${minsLeft} ${minsLeft === 1 ? 'minute' : 'minutes'} left. Open the timer`
                : `Start a pomodoro for ${title}`}
              testID={testID ? `${testID}-pomodoro` : undefined}
              style={[
                styles.pomodoroKey,
                // LIVE wears the red it has been hinting at all along: the key
                // is the block now, not the button that starts one.
                live
                  // The outline goes TRANSPARENT while live — the ring drawn
                  // inside is the outline then, and a static edge around it
                  // would be a second one that never moves.
                  ? { backgroundColor: key.liveFill, borderColor: 'transparent' }
                  : { backgroundColor: key.fill, borderColor: key.edge },
              ]}
            >
              {/* Same faint board wash as the key above it — but not while a
                  block is LIVE: the red is the signal then, and a board tint
                  under it is one colour too many in a 56 pt circle. */}
              {!live && !!keyTint && (
                <View
                  pointerEvents="none"
                  style={[StyleSheet.absoluteFill, { backgroundColor: keyTint }]}
                  testID={testID ? `${testID}-pomodoro-tint` : undefined}
                />
              )}
              <KeySheen
                colors={live ? key.liveSheen : key.sheen}
                testID={testID ? `${testID}-pomodoro-sheen` : undefined}
              />
              {/* The RADIAL countdown: the outline itself, shortening as the
                  block burns down. Over the sheen — it is the signal, the
                  gloss is only light. The number says how long is left, the
                  ring says how much of the block that is. */}
              {live && level != null && (
                <KeyRing
                  pct={level}
                  color={key.red}
                  track={key.liveTrack}
                  testID={testID ? `${testID}-pomodoro-ring` : undefined}
                />
              )}
              {/* RUNNING: the minutes left, counted down in place, so the key
                  that starts a focus block is also the one that tells you how
                  much of it is left. Idle: the timer glyph. */}
              {live
                ? (
                  <View style={styles.pomodoroLive}>
                    <Text style={[styles.pomodoroCount, { color: key.red }]} numberOfLines={1}>
                      {minsLeft}
                    </Text>
                    {/* The unit, quietly — without it a bare "13" in a circle
                        could be a count of blocks rather than minutes left,
                        which is the other number this card already shows. */}
                    <Text style={[styles.pomodoroUnit, { color: key.red }]} numberOfLines={1}>m</Text>
                  </View>
                )
                : <Icon name="timer-outline" size={KEY_GLYPH} color={key.red} />}
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

export default memo(ScheduleCard);

/**
 * The gutter. 64 rather than 74: at 11 pt "12:38 PM" — the longest a time gets
 * — measures about 48, so 64 less the 10 pt inset holds it in full with room
 * to spare, and the column stops eating width the card wants.
 */
export const TIME_COL_W = 64;

/**
 * ONE card height, and keys sized from it — so every card in a list is the
 * same, and the two keys beside each are the same as each other and as every
 * other card's.
 *
 * They used to be measured per card (`keyFit`): a one-line title made a
 * shorter card, which made smaller keys, so a column had cards of three
 * heights and keys of three sizes. Fixing the CARD is what fixes the keys —
 * measuring could only ever chase the inconsistency.
 *
 * 120 is the two-line case: padding 14 + two 21 pt title lines + the board
 * line + the bottom row + padding 12. A one-line title leaves slack rather
 * than shrinking the card, which is the whole point.
 *
 * Scaled by the device's accessibility font scale (constant for the app's
 * lifetime), so large-text users get a taller card instead of a sheared one.
 */
/**
 * The keys are a THIN OUTLINE over light grey, with white bleeding in off the
 * edges — a quiet control beside a coloured card, where the charcoal slab
 * before it was the loudest thing on the row and the card's own wash was too
 * quiet to read as a button at all.
 *
 * On the dark page the same shape is a frosted grey rather than a white slab:
 * light grey by its own lights is fine on a white page, and a headlight on a
 * black one.
 *
 * The GLYPHS follow the surface they sit on: the deeper pair on the pale key
 * (#34D399 / #F87171 are tuned for near-black and go washy on grey), the
 * lighter pair on the frosted one. `done` fills with the mint and takes a
 * white check — it is the one key that is not quiet.
 */
const KEY_DONE = '#34D399';
const keySurface = (dark) => (dark
  ? {
    fill: 'rgba(255,255,255,0.09)',
    edge: 'rgba(255,255,255,0.20)',
    sheen: ['rgba(255,255,255,0.26)', 'rgba(255,255,255,0)', 'rgba(255,255,255,0.16)'],
    green: '#34D399',
    red: '#F87171',
    // LIVE — the same construction in the timer's own red, with the outline
    // replaced by the countdown ring. Held to a TINT rather than a solid: the
    // row's colour is the board's, and a key that shouts drags the eye off the
    // card it belongs to.
    liveFill: 'rgba(248,113,113,0.16)',
    // What the countdown arc eats into: the same red, faint enough that the
    // arc is what you read and the rest is only where it has been.
    liveTrack: 'rgba(248,113,113,0.22)',
    liveSheen: ['rgba(255,255,255,0.20)', 'rgba(255,255,255,0)', 'rgba(255,255,255,0.12)'],
  }
  : {
    // Deep enough that the white off the edges is something you can SEE. At
    // #F5F6F7 the grey and the gloss were the same colour and the key was a
    // flat outline with nothing in it.
    fill: '#E7E9ED',
    edge: 'rgba(15,23,42,0.13)',
    sheen: ['rgba(255,255,255,0.92)', 'rgba(255,255,255,0)', 'rgba(255,255,255,0.72)'],
    green: '#0E9F6E',
    red: '#E02424',
    liveFill: '#FCE9E9',
    liveTrack: 'rgba(224,36,36,0.18)',
    liveSheen: ['rgba(255,255,255,0.85)', 'rgba(255,255,255,0)', 'rgba(255,255,255,0.60)'],
  });

/**
 * White off the EDGES: white at both ends, transparent through the middle, ONE
 * pass down the key and one across it — so the light comes in from all four
 * sides and the grey only holds the centre. There is no radial mode in
 * expo-linear-gradient; two crossed linears are what read as one. They
 * compound at the corners, which is where an edge light is brightest anyway,
 * so the alphas are set below what one pass would want.
 */
const SHEEN_STOPS = [0, 0.5, 1];
const ACROSS_START = { x: 0, y: 0.5 };
const ACROSS_END = { x: 1, y: 0.5 };

function KeySheen({ colors, testID }) {
  return (
    <>
      <LinearGradient
        colors={colors}
        locations={SHEEN_STOPS}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
        testID={testID}
      />
      <LinearGradient
        colors={colors}
        locations={SHEEN_STOPS}
        start={ACROSS_START}
        end={ACROSS_END}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
        testID={testID ? `${testID}-across` : undefined}
      />
    </>
  );
}

/**
 * The live key's OUTLINE, as an arc that shrinks with the block: a full ring
 * at the start, a sliver at the end, drawn clockwise from 12 o'clock.
 *
 * Built from two rotating half-rings, NOT from SVG — there is no
 * `react-native-svg` in this project, and adding one is a native module, which
 * an OTA update cannot ship. A View with a circular border paints each side's
 * colour over a 90° arc, so colouring the TOP and RIGHT edges and leaving the
 * other two transparent gives exactly a half-ring. Two of those, each inside a
 * window clipped to its own half of the circle, cover the full 360°.
 *
 * The rotations fall out of that geometry. Measuring clockwise from 12 o'clock,
 * an unrotated top+right half spans −45°→135°, and the RIGHT window shows
 * 0°→180°. Turning it by `r` moves the painted span to (r−45)→(r+135), so its
 * trailing edge sits at `D` when r = D − 135: at D = 180 that is 45° and the
 * whole right side shows, at D = 0 it is −135° and the painted half has swung
 * entirely out of the window. The LEFT window shows 180°→360°, so the same sum
 * gives r = S + 45 for S degrees past the halfway mark.
 *
 * `pct` is what is LEFT, so the ring empties anticlockwise from the bottom as
 * the minutes go — the outline disappearing in proportion to the count.
 */
const RING_W = 2;
/** How often the arc is redrawn while a block runs — see the tick effect. */
const RING_STEP = 10000;

/**
 * The two rotations for a ring `pct` full, in degrees. Exported because the
 * ANCHOR is the part that can be quietly wrong — an arc 90° out still grows and
 * shrinks correctly, it just starts at 3 o'clock — and that is checkable as
 * arithmetic without rendering anything.
 */
export function KeyRingRotations(pct) {
  const deg = Math.max(0, Math.min(100, Number(pct) || 0)) * 3.6;
  return {
    right: Math.round((Math.min(deg, 180) - 135) * 10) / 10,
    left: Math.round((Math.max(0, deg - 180) + 45) * 10) / 10,
  };
}

function KeyRing({ pct, color, track, testID }) {
  const { right, left } = KeyRingRotations(pct);
  const half = (side, rotate) => (
    <View style={[styles.ringWindow, side === 'left' ? styles.ringWindowLeft : styles.ringWindowRight]}>
      <View
        style={[
          styles.ringHalf,
          side === 'left' ? styles.ringHalfLeft : styles.ringHalfRight,
          { borderTopColor: color, borderRightColor: color, transform: [{ rotate: `${rotate}deg` }] },
        ]}
        testID={testID ? `${testID}-${side}` : undefined}
      />
    </View>
  );
  return (
    <View pointerEvents="none" style={styles.ring} testID={testID}>
      {/* What the arc is eating into. The key's own border goes transparent
          while live, so this track IS the outline — the ring does not sit
          inside a second, competing edge. */}
      <View style={[styles.ringTrack, { borderColor: track }]} testID={testID ? `${testID}-track` : undefined} />
      {half('right', right)}
      {half('left', left)}
    </View>
  );
}
/**
 * The FOCUS SESSIONS line: its own row across the foot of the card, the label
 * on the left edge and the dots on the right.
 *
 * `FOCUS_ROW` is the label's line box and `FOCUS_GAP` the air above it — 20 pt
 * between them, which a card with a one-line title absorbs inside its existing
 * 120 without growing at all. Only a two-line title with sessions under it
 * makes the card taller; see CARD_H.
 *
 * The dots are 6 pt with 4 between: small enough that eight of them and the
 * label both fit the card's ~190 pt of inner width, big enough to count.
 * Past MAX_FOCUS_DOTS they stop being countable anyway and the tail becomes a
 * "+n", exactly as the face stack does at MAX_FACES.
 */
const FOCUS_ROW = 14;
const FOCUS_GAP = 6;
export const FOCUS_DOT = 6;
export const FOCUS_DOT_GAP = 4;
export const MAX_FOCUS_DOTS = 8;

const FONT_SCALE = Math.max(1, PixelRatio.getFontScale());
const TITLE_LINE = 21;
/**
 * The card's height — a FLOOR now, not a lock (`card.minHeight`).
 *
 * 120 is what it has always been, and what the keys are cut from, and the two
 * facts are the same fact: two keys and their gap ARE the card, so a card that
 * grew took the keys with it. Growing it to make room for the focus line
 * pushed them to 66, which is why this went back.
 *
 * A floor rather than a lock because 120 does not hold everything at once: it
 * holds a two-line title, OR a one-line title and the focus line, but not both
 * (14 + 42 + 19 + 32 + 20 + 12 = 139). Locking it at 139 would spend 19 pt of
 * dead space at the foot of every ordinary card to buy a level column; locking
 * it at 120 would mean cutting titles to one line. A floor gives the common
 * card — anything up to a two-line title, anything up to a one-line title with
 * focus sessions — exactly the 120 it always had, and lets the rare card that
 * carries both simply be taller.
 *
 * What that costs is the guarantee that every card in a column is the same
 * height; the keys stay one size regardless, because they are cut from this
 * constant and not from the card they sit beside. On a card that has grown, the
 * key column is top-aligned and stops short of the foot.
 */
export const CARD_H = Math.round(120 * FONT_SCALE);
/** Air between the two keys. */
export const KEY_GAP = 8;
/**
 * Both keys, one number: two of them plus the gap are exactly the card, so the
 * column starts and ends where the card does.
 */
export const KEY = Math.round((CARD_H - KEY_GAP) / 2);
/** The glyph inside a key. */
const KEY_GLYPH = Math.round(KEY * 0.42);
/**
 * The countdown ring's diameter: the key's PADDING box, i.e. the key less its
 * 1 pt outline on each side. A child cannot paint into its parent's border, so
 * this is the largest circle the ring can be — and while a block is live the
 * outline is transparent, which makes this ring the key's edge.
 */
const RING = KEY - 2;
// Kept as names because they read better at the call sites; they are one size.
export const DONE_KEY = KEY;
export const POMODORO_KEY = KEY;

/**
 * The now-line's stub across a card, and the red it is drawn in.
 *
 * 11, because the card's text starts at 16 (`card.paddingHorizontal`) and the
 * mark has to stop SHORT of it: this is a line entering the card, not a line
 * crossing it. The dot is the grid's own 8 pt marker at the same −4 so it
 * straddles the card's left edge exactly as the full-width one straddles the
 * gutter rule — the two are the same marker, one of them cut off.
 *
 * NOW_RED is only the fallback for a theme with no `accentError`; it is the
 * same literal the hour grid's line falls back to, so they cannot drift.
 */
export const NOW_STUB_W = 11;
const NOW_RED = '#FF4444';
const NOW_DOT = 8;

/**
 * Where the now-mark sits on a card, in points from the card's top edge, for a
 * task `frac` of the way through — or null when there is no mark to place.
 *
 * A proportion, not a y off the clock, because a card is CARD_H whatever its
 * duration: "half way down the card" is the only reading of "half way through
 * the task" this shape can carry. The −1 centres the 2 pt bar on the minute.
 *
 * Held half a dot off each end. At frac 0 or 1 the dot — which straddles the
 * card's left edge on purpose — would hang half off the top or bottom of a card
 * whose corners are rounded anyway, and read as a stray dot beside the card
 * rather than a line entering it. Half a dot is under 4 % of a card, which is
 * finer than the mark can resolve in the first place.
 */
export function nowMarkTop(frac) {
  const f = Number(frac);
  if (frac == null || !Number.isFinite(f)) return null;
  const y = Math.max(0, Math.min(1, f)) * CARD_H;
  return Math.round(Math.max(NOW_DOT / 2, Math.min(CARD_H - NOW_DOT / 2, y))) - 1;
}

/** The avatar disc on a card, and how much of it the next one covers. */
export const PERSON = 22;
/** A THIRD, so each extra person costs two thirds of a disc and the faces
 *  stay readable. Two thirds packed them almost on top of one another. */
export const PERSON_OVERLAP = Math.round(PERSON * (1 / 3));
/** Past this the discs stop being faces; the rest becomes "+n". */
export const MAX_FACES = 4;

// A stretch of free hours longer than this collapses into ONE "Nh free" row
// (the reference lists every hour, but a 06:00 → 22:00 day with two tasks
// would be sixteen dashed rows).
export const CONDENSE_AFTER_HOURS = 3;

/**
 * The condensed hour timeline for the day panel's compact schedule: from the
 * first task's hour to the last task's end, one row per hour — a task card
 * on the hour a task starts (the card stands for the hours it covers), a
 * dashed empty row for a free hour, and a single "free" row for a long
 * empty stretch. `segments` are {task, start, end} in minutes, start-sorted.
 * Returns [{ kind: 'task', seg, minute } | { kind: 'empty', minute } |
 * { kind: 'free', minute, minutes }].
 */
export function buildCondensedRows(segments) {
  const segs = (segments || []).filter((s) => s && Number.isFinite(s.start)).slice().sort((a, b) => a.start - b.start);
  if (!segs.length) return [];
  const rows = [];
  const dayEnd = Math.max(...segs.map((s) => Math.max(s.end || 0, s.start + 1)));
  let cursor = Math.floor(segs[0].start / 60) * 60; // the hour the day starts on
  let i = 0;
  let guard = 0;
  while ((i < segs.length || cursor < dayEnd) && guard++ < 200) {
    const seg = segs[i];
    if (seg && seg.start < cursor + 60) {
      // Starts inside this hour (or earlier, overlapping the previous card).
      rows.push({ kind: 'task', seg, minute: seg.start });
      i += 1;
      // The card covers its hours: resume on the first hour after it ends
      // (never move backwards past the hour we are on).
      const endHour = Math.ceil(Math.max(seg.end || seg.start + 1, seg.start + 1) / 60) * 60;
      cursor = Math.max(cursor + 60, endHour);
      continue;
    }
    // A free hour. Measure the free run up to the next task (or the day's end).
    const next = seg ? Math.floor(seg.start / 60) * 60 : dayEnd;
    const freeHours = Math.max(1, Math.ceil((next - cursor) / 60));
    if (freeHours > CONDENSE_AFTER_HOURS) {
      rows.push({ kind: 'empty', minute: cursor });
      rows.push({ kind: 'free', minute: cursor + 60, minutes: (freeHours - 1) * 60 });
      cursor += freeHours * 60;
    } else {
      rows.push({ kind: 'empty', minute: cursor });
      cursor += 60;
    }
  }
  return rows;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
    // The gap between the card and the key beside it. The card is flex: 1, so
    // it simply takes what is left — which is what makes it narrower.
    gap: 8,
  },
  // The time reads CLEARLY beside its card (the reference's "08 AM"): a
  // mid-size medium-weight label in the secondary ink, on the card's first
  // line. Minutes stay ("08:30 AM"); the column is wide enough for them.
  //
  // It LINES UP with that first line rather than floating above it: the same
  // top inset as the card (14) and the same lineHeight as the title (21), so
  // the two line boxes start at the same y and are the same height — the ink
  // centres identically in both. It used to guess with paddingTop 15 against
  // the title's natural leading and sat a few points high.
  // The time is ONE column with the hour rules drawn between the cards — the
  // compact list and the expanded grid interleave in this view, so a different
  // size or a ragged left edge reads as two columns fighting. Same width, same
  // 10 pt inset, same 11 / 500 / 0.2 in the secondary ink, RIGHT-aligned into
  // the rule. It used to be 14 pt and left-aligned, which is what made
  // "2:38 PM" sit out past the hour labels in a bigger face.
  //
  // paddingTop + lineHeight are the CARD's first line, not the rule's: the ink
  // centres in a 21 pt line box starting 14 pt down, exactly where the title
  // does, so the time reads as belonging to the card it names.
  time: {
    width: TIME_COL_W,
    paddingTop: 14,
    paddingRight: 10,
    textAlign: 'right',
    fontSize: 11,
    lineHeight: 21,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.2,
  },
  card: {
    flex: 1,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    // A FLOOR (see CARD_H): the card is the familiar 120 whatever it carries,
    // and grows only for the one combination that genuinely does not fit —
    // a two-line title with focus sessions under it. It was a hard `height`,
    // which meant a one-line title left its spare line as dead space at the
    // foot, under the focus line, where it read as a hole rather than as
    // padding.
    minHeight: CARD_H,
  },
  // No reserved second line. The card's height is a floor, so a one-line title
  // simply leaves the card at 120 with its slack under the content — which is
  // where padding belongs — instead of forcing a 21 pt hole somewhere.
  top: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  title: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: TITLE_LINE,
  },
  struck: {
    textDecorationLine: 'line-through',
  },
  // Over the card's own content (zIndex), because the card is what it is
  // passing through. `top` is set per render from the minute.
  nowMark: {
    position: 'absolute',
    left: 0,
    flexDirection: 'row',
    alignItems: 'center',
    height: 2,
    zIndex: 5,
    elevation: 5,
  },
  nowMarkDot: {
    width: NOW_DOT,
    height: NOW_DOT,
    borderRadius: NOW_DOT / 2,
    marginLeft: -NOW_DOT / 2,
  },
  nowMarkBar: {
    width: NOW_STUB_W,
    height: 2,
    borderRadius: 1,
  },
  // The two keys stack, aligned to the card's top edge.
  keys: { gap: KEY_GAP },
  doneKey: {
    width: KEY,
    height: KEY,
    borderRadius: Math.round(KEY * 0.3),
    alignItems: 'center',
    justifyContent: 'center',
    // A thin outline — 1, not a hairline: at 0.33 pt the rim of a 66 pt key
    // disappears against a white page, and the rim is the only thing giving a
    // key washed in its card's own colour an edge against that card.
    borderWidth: 1,
    overflow: 'hidden',
  },
  // A CIRCLE: the same box, the radius taken all the way round. Only the
  // corner says they are different kinds of thing.
  pomodoroKey: {
    width: KEY,
    height: KEY,
    borderRadius: KEY / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    overflow: 'hidden',
  },
  // The ring fills the key's PADDING box — the box inside its 1 pt border,
  // which is transparent while live — so the arc lands where the outline was.
  // Sized in POINTS off `RING`, not in percentages: the track and the two
  // halves have to be the same circle to a pixel, and `borderRadius` takes no
  // percentage, so a half sized any other way is a hair off the track it is
  // supposed to be eating.
  ring: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: RING,
    height: RING,
  },
  ringTrack: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: RING_W,
    borderRadius: RING / 2,
  },
  // Each window clips to its own half of the circle, so the half-ring inside
  // it can be rotated right out of view.
  ringWindow: {
    position: 'absolute',
    top: 0,
    width: RING / 2,
    height: RING,
    overflow: 'hidden',
  },
  ringWindowLeft: { left: 0 },
  ringWindowRight: { right: 0 },
  // A full-size circle inside a half-size window, pinned to the window's OUTER
  // edge — which puts its centre on the ring's centre, so the two halves line
  // up into one circle and each rotates about that shared centre.
  ringHalf: {
    position: 'absolute',
    top: 0,
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: RING_W,
    // Two sides painted, two transparent — that is what makes it a half-ring.
    borderBottomColor: 'transparent',
    borderLeftColor: 'transparent',
  },
  ringHalfLeft: { left: 0 },
  ringHalfRight: { right: 0 },
  // The number and its unit on ONE baseline, centred as a pair.
  pomodoroLive: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  // The minutes left, in the circle. Tabular so the number does not jump
  // about as it counts down — and a touch smaller than it was alone, now that
  // the unit sits beside it and two digits plus an "m" have to fit.
  pomodoroCount: {
    fontSize: Math.round(KEY * 0.34),
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  pomodoroUnit: {
    fontSize: Math.round(KEY * 0.2),
    fontWeight: '700',
    opacity: 0.75,
    marginLeft: 1,
  },
  sub: {
    fontSize: 13,
    fontWeight: '400',
    marginTop: 3,
  },
  // A placeholder is a stand-in, not a fact: same room, quieter voice.
  subMissing: { fontStyle: 'italic' },
  bottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  bottomRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 'auto',
  },
  // The label hard against the card's left content edge, the dots hard against
  // its right — the same two edges the title and the time range already use, so
  // the foot of the card reads as one column rather than a third alignment.
  // A FIXED height, because the row is reserved on every card (see FOCUS_ROW)
  // and a row that changed height with its contents would undo that.
  focus: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: FOCUS_ROW,
    marginTop: FOCUS_GAP,
  },
  focusLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
    // Yields to the dots: with a full row of them the label truncates rather
    // than pushing them off the card's right edge, which is the edge they are
    // being read against.
    flexShrink: 1,
    marginRight: 8,
  },
  focusDots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: FOCUS_DOT_GAP,
  },
  focusDot: {
    width: FOCUS_DOT,
    height: FOCUS_DOT,
    borderRadius: FOCUS_DOT / 2,
  },
  focusMore: {
    fontSize: 10,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    marginLeft: 1,
  },
  range: {
    fontSize: 12,
    fontWeight: '400',
    fontVariant: ['tabular-nums'],
  },
  people: { flexDirection: 'row', alignItems: 'center' },
  person: {
    width: PERSON,
    height: PERSON,
    borderRadius: PERSON / 2,
    alignItems: 'center',
    justifyContent: 'center',
    // Clips the photo to the disc — without it the image is a square over a
    // round badge.
    overflow: 'hidden',
  },
  personMore: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  personMoreText: { fontSize: 9, fontWeight: '800' },
  ownerText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.7,
  },
  done: {
    opacity: 0.55,
  },
});
