/**
 * FocusDayPanel — one day of focus, and what that day was worth.
 *
 * The Today tile prints "50m · 2 blocks". That is a number with nothing beside
 * it, and a number with nothing beside it is not something you can act on: 50
 * minutes is a poor Saturday and an excellent Monday. This is what the tile
 * opens into, and the whole design is the CONTEXT — the day is three cards,
 * and two of them are comparisons.
 *
 *   1. The day      — the hero figure, its blocks, when they ran, where the
 *                     time went, and the attempts that did not finish.
 *   2. Your Tuesdays — the same weekday, all time. This is the comparison
 *                     people actually make, because the same weekday is what
 *                     has the same shape: the same meetings, the same commute.
 *   3. Every day     — the day against the whole record, so a good Tuesday
 *                     that is also a good DAY reads as one.
 *
 * The arithmetic is utils/focusDay, pure and tested — including the part that
 * is easy to get wrong and impossible to see: both averages EXCLUDE this day,
 * or every day is partly compared with itself and everything reads "about
 * usual".
 *
 * Drawn the way FocusStatsPanel is drawn, because it is its sibling and opens
 * from the same page: Views for marks (no react-native-svg — it would move the
 * runtime fingerprint and cost the OTA), one sequential hue for magnitude, and
 * the card / figure / meter shapes that panel already established.
 */
import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { insetRule } from '../../../utils/surfaceDepth';
import { formatMinutes } from '../utils/focusStats';
import { clockLabel, compareToAverage, focusDayStats, ordinal } from '../utils/focusDay';
import { RAMP, rampStep } from './StatsPanel';
import { SCROLL_INDICATOR } from '../../../utils/scrollIndicator';

/** A mark with nothing in it is the TRACK, never a ramp step: nothing must
 *  never read as a little. Same rule as the stats panel's charts. */
const markColor = (value, max, pal) => {
  const step = rampStep(value, max);
  return step < 0 ? pal.track : RAMP[step];
};

/** A section: a title, an optional one-line note, and the plot under them. */
function Card({ title, note, children, pal, testID }) {
  return (
    <View
      style={[styles.card, { backgroundColor: pal.card, borderColor: pal.edge, borderTopColor: pal.edgeTop }]}
      testID={testID}
    >
      <Text style={[styles.cardTitle, { color: pal.text }]} numberOfLines={1}>{title}</Text>
      {!!note && <Text style={[styles.cardNote, { color: pal.muted }]}>{note}</Text>}
      {children}
    </View>
  );
}

/** A headline number under a caption. */
function Figure({ value, caption, pal, icon, accent, testID }) {
  return (
    <View style={styles.figure} testID={testID}>
      <View style={styles.figureTop}>
        {!!icon && <Icon name={icon} size={13} color={accent || pal.muted} />}
        <Text style={[styles.figureCaption, { color: pal.muted }]} numberOfLines={1}>{caption}</Text>
      </View>
      <Text style={[styles.figureValue, { color: accent || pal.text }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

/**
 * When in the day it happened — 24 cells, one per hour, inked by how much.
 * The night hours stay: an empty 3am is part of the shape, and a strip that
 * began at your earliest block would rescale itself after one odd morning.
 */
function HourStrip({ byHour, pal }) {
  const peak = Math.max(1, ...byHour);
  return (
    <View testID="focus-day-hours">
      <View style={styles.hours}>
        {byHour.map((m, h) => (
          <View key={h} style={[styles.hourCell, { backgroundColor: markColor(m, peak, pal) }]} />
        ))}
      </View>
      <View style={styles.hourAxis}>
        {['12a', '6a', '12p', '6p', '11p'].map((t) => (
          <Text key={t} style={[styles.axisText, { color: pal.muted }]}>{t}</Text>
        ))}
      </View>
    </View>
  );
}

/** One ratio against its whole — the honest form of a two-slice pie. */
function Meter({ pct, pal, accent }) {
  return (
    <View style={styles.meterWrap}>
      <View style={[styles.meterTrack, { backgroundColor: pal.track }]}>
        <View style={[styles.meterFill, { width: `${Math.max(0, Math.min(100, pct))}%`, backgroundColor: accent || RAMP[3] }]} />
      </View>
    </View>
  );
}

/**
 * The sentence under the hero: how the day sits against the same weekday.
 *
 * It is the first thing read, so it has to be true in the three awkward
 * cases — no focus at all, a first-ever Tuesday, and dead level — rather than
 * printing "0% above average" and leaving the reader to work out which.
 */
function weekdayVerdict(s) {
  const { weekday, weekdayName, minutes } = s;
  if (!minutes) return `Nothing on this ${weekdayName} yet.`;
  if (!weekday.comparable) return `Your first ${weekdayName} with focus on it.`;
  const pct = compareToAverage(minutes, weekday.averageMinutes);
  const usual = `your usual ${formatMinutes(weekday.averageMinutes)}`;
  if (pct === null || pct === 0) return `Level with ${usual} on a ${weekdayName}.`;
  return pct > 0
    ? `${pct}% above ${usual} on a ${weekdayName}.`
    : `${Math.abs(pct)}% below ${usual} on a ${weekdayName}.`;
}

function FocusDayPanel({
  sessions,
  boardOfTask,
  taskOfId,
  pal,
  theme,
  onClose,
  // Any instant inside the day being shown.
  dayMs,
  use24h = false,
  insetTop = 0,
  bottomInset = 0,
}) {
  const c = theme.colors;
  const s = useMemo(
    () => focusDayStats(sessions, dayMs, boardOfTask, taskOfId),
    [sessions, dayMs, boardOfTask, taskOfId],
  );

  const title = new Date(s.dayMs)
    .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  // The day against the best one of its own weekday, as a bar you can read at
  // a glance. Against the BEST rather than the average: a meter whose fill can
  // exceed its track is not a meter.
  const weekdayBest = s.weekday.best?.minutes || 0;
  const weekdayPct = weekdayBest > 0 ? (s.minutes / weekdayBest) * 100 : 0;
  const allBest = s.allTime.best?.minutes || 0;
  const allPct = allBest > 0 ? (s.minutes / allBest) * 100 : 0;

  const boardPeak = Math.max(1, ...s.boards.map((b) => b.minutes));
  const span = s.firstStart && s.lastEnd
    ? `${clockLabel(s.firstStart, use24h)} – ${clockLabel(s.lastEnd, use24h)}`
    : null;

  return (
    <View style={[styles.page, { backgroundColor: c.background, paddingTop: insetTop }]}>
      {/* THE APP'S ONE SEPARATOR, not a hairline of this panel's own: two
          lines, a score and a highlight, so the bar reads as cut into the page
          rather than drawn on it. utils/surfaceDepth owns it, and
          headerRule.scan is what stops a new screen going its own way — which
          this panel did on its first pass, by copying the sibling that has
          not been converted yet. */}
      <View style={[styles.topBar, insetRule(theme)]}>
        <Pressable
          onPress={onClose}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={({ pressed }) => [styles.backKey, pressed && styles.pressed]}
          testID="focus-day-back"
        >
          <Icon name="chevron-left" size={28} color={c.textPrimary} />
        </Pressable>
        <Text style={[styles.topTitle, { color: c.textPrimary }]} numberOfLines={1}>{title}</Text>
        <View style={styles.topRight} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: 32 + bottomInset }]}
        showsVerticalScrollIndicator
        {...SCROLL_INDICATOR}
        testID="focus-day-scroll"
      >
        {/* ── 1. THE DAY ─────────────────────────────────────────────────── */}
        <Card title="The day" note={weekdayVerdict(s)} pal={pal} testID="focus-day-card">
          <Text style={[styles.hero, { color: pal.text }]} testID="focus-day-total">
            {s.minutes ? formatMinutes(s.minutes) : '—'}
          </Text>

          <View style={styles.figureRow}>
            <Figure
              icon="timer-outline"
              caption={s.blocks === 1 ? 'block' : 'blocks'}
              value={String(s.blocks)}
              pal={pal}
              testID="focus-day-blocks"
            />
            <Figure icon="chart-donut" caption="average" value={s.average ? `${s.average}m` : '—'} pal={pal} />
            <Figure icon="arrow-expand-vertical" caption="longest" value={s.longest ? `${s.longest}m` : '—'} pal={pal} />
          </View>

          {!!span && (
            <Text style={[styles.cardFoot, { color: pal.muted }]} testID="focus-day-span">
              {`First to last · ${span}`}
            </Text>
          )}
          {/* Said plainly, as context for the figure above it rather than as a
              telling-off: it is what makes the completed total mean something. */}
          {s.abandoned > 0 && (
            <Text style={[styles.cardFoot, { color: pal.muted }]} testID="focus-day-abandoned">
              {`${s.abandoned} ${s.abandoned === 1 ? 'block' : 'blocks'} started and not finished`}
            </Text>
          )}
        </Card>

        {s.minutes > 0 && (
          <Card title="When" note="The hours you actually defended" pal={pal}>
            <HourStrip byHour={s.byHour} pal={pal} />
          </Card>
        )}

        {s.boards.length > 0 && (
          <Card title="Where it went" pal={pal} testID="focus-day-boards">
            {s.boards.map((b) => (
              <View key={b.name} style={styles.barRow}>
                <Text style={[styles.barLabel, { color: pal.text }]} numberOfLines={1}>{b.name}</Text>
                <View style={[styles.barTrack, { backgroundColor: pal.track }]}>
                  <View style={[styles.barFill, { width: `${(b.minutes / boardPeak) * 100}%`, backgroundColor: markColor(b.minutes, boardPeak, pal) }]} />
                </View>
                <Text style={[styles.barValue, { color: pal.muted }]}>{formatMinutes(b.minutes)}</Text>
              </View>
            ))}
          </Card>
        )}

        {/* ── 2. THE SAME WEEKDAY ────────────────────────────────────────── */}
        <Card
          title={`Your ${s.weekdayName}s`}
          note={s.weekday.days > 1
            ? `${s.weekday.days} of them on record`
            : 'Only this one so far'}
          pal={pal}
          testID="focus-day-weekday"
        >
          <View style={styles.figureRow}>
            <Figure
              icon="chart-line"
              caption="usual"
              value={s.weekday.comparable ? formatMinutes(s.weekday.averageMinutes) : '—'}
              pal={pal}
              testID="focus-day-weekday-average"
            />
            <Figure
              icon="trophy-outline"
              caption="best"
              value={weekdayBest ? formatMinutes(weekdayBest) : '—'}
              pal={pal}
            />
            <Figure
              icon="podium"
              caption="this one"
              value={s.weekday.rank ? ordinal(s.weekday.rank) : '—'}
              pal={pal}
              accent={s.weekday.rank === 1 ? '#F59E0B' : null}
              testID="focus-day-weekday-rank"
            />
          </View>
          {weekdayBest > 0 && <Meter pct={weekdayPct} pal={pal} />}
          {s.weekday.best && (
            <Text style={[styles.cardFoot, { color: pal.muted }]}>
              {s.weekday.rank === 1 && s.minutes > 0
                ? `Your best ${s.weekdayName} yet.`
                : `Best was ${new Date(s.weekday.best.ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${formatMinutes(s.weekday.best.minutes)}`}
            </Text>
          )}
        </Card>

        {/* ── 3. EVERY DAY ───────────────────────────────────────────────── */}
        <Card
          title="Against every day"
          note={s.allTime.days
            ? `${s.allTime.days} ${s.allTime.days === 1 ? 'day' : 'days'} with focus · ${formatMinutes(s.allTime.minutes)} all told`
            : 'No focus on record yet'}
          pal={pal}
          testID="focus-day-alltime"
        >
          <View style={styles.figureRow}>
            <Figure
              icon="chart-line"
              caption="usual day"
              value={s.allTime.averageMinutes ? formatMinutes(s.allTime.averageMinutes) : '—'}
              pal={pal}
            />
            <Figure
              icon="trophy-outline"
              caption="best day"
              value={allBest ? formatMinutes(allBest) : '—'}
              pal={pal}
            />
            <Figure
              icon="podium"
              caption="this one"
              value={s.allTime.rank ? ordinal(s.allTime.rank) : '—'}
              pal={pal}
              accent={s.allTime.rank === 1 ? '#F59E0B' : null}
              testID="focus-day-alltime-rank"
            />
          </View>
          {allBest > 0 && <Meter pct={allPct} pal={pal} />}
        </Card>

        {/* ── The blocks themselves ──────────────────────────────────────── */}
        {s.sessions.length > 0 && (
          <Card title="The blocks" note="In the order they ran" pal={pal} testID="focus-day-sessions">
            {s.sessions.map((b) => (
              <View key={b.id} style={[styles.blockRow, { borderBottomColor: pal.edge }]}>
                <Text style={[styles.blockTime, { color: pal.muted }]}>{clockLabel(b.startedAt, use24h)}</Text>
                <View style={styles.blockBody}>
                  <Text style={[styles.blockTitle, { color: pal.text }]} numberOfLines={1}>
                    {b.title || b.board || 'Focus'}
                  </Text>
                  {!!(b.title && b.board) && (
                    <Text style={[styles.blockBoard, { color: pal.muted }]} numberOfLines={1}>{b.board}</Text>
                  )}
                </View>
                <Text style={[styles.blockMins, { color: pal.text }]}>{`${b.minutes}m`}</Text>
              </View>
            ))}
          </Card>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  topBar: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  backKey: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  topTitle: { flex: 1, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  topRight: { width: 40 },
  pressed: { opacity: 0.6 },

  body: { paddingHorizontal: 16, paddingTop: 12 },

  card: { borderRadius: 16, borderWidth: 1, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14, marginBottom: 10 },
  cardTitle: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.9, textTransform: 'uppercase' },
  cardNote: { fontSize: 11.5, fontWeight: '600', marginTop: 3, lineHeight: 16 },
  cardFoot: { fontSize: 11.5, fontWeight: '600', marginTop: 10 },

  hero: { fontSize: 40, fontWeight: '800', letterSpacing: -1.2, marginTop: 8 },

  figureRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  figure: { flex: 1, minWidth: 0 },
  figureTop: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  figureCaption: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  figureValue: { fontSize: 19, fontWeight: '800', marginTop: 3 },

  meterWrap: { marginTop: 12 },
  meterTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  meterFill: { height: 6, borderRadius: 3 },

  hours: { flexDirection: 'row', gap: 2, marginTop: 12 },
  hourCell: { flex: 1, height: 26, borderRadius: 3 },
  hourAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 },
  axisText: { fontSize: 9, fontWeight: '600' },

  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  barLabel: { width: 92, fontSize: 12, fontWeight: '600' },
  barTrack: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  barValue: { width: 54, fontSize: 11, fontWeight: '700', textAlign: 'right' },

  blockRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth },
  blockTime: { width: 62, fontSize: 11, fontWeight: '700' },
  blockBody: { flex: 1, minWidth: 0 },
  blockTitle: { fontSize: 13.5, fontWeight: '600' },
  blockBoard: { fontSize: 10.5, fontWeight: '600', marginTop: 1 },
  blockMins: { fontSize: 13, fontWeight: '800' },
});

export default React.memo(FocusDayPanel);
