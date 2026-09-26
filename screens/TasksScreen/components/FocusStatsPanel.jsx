/**
 * FocusStatsPanel — the Focus page's stats, over a period you choose: this
 * week, this month, this year, or the lot.
 *
 * The Focus page itself answers "what is today and is the run alive". This
 * answers the weekly question — how the month compares with the last one, which
 * hours you actually defend, what your best run has ever been — and it gets its
 * own page because those charts want the width, exactly as the Overview's
 * StatsPanel does for tasks.
 *
 * ─── The charts are made of Views, and the palette is one hue ───────────────
 *
 * Both for the reasons written out at the top of StatsPanel, which this panel
 * is the sibling of: there is no react-native-svg and adding it would move the
 * runtime fingerprint (no OTA), so marks are rectangles — columns, bars, heat
 * cells, meters. And every figure on this page encodes MAGNITUDE (how many
 * minutes), which is a sequential job: one hue, light→dark. Eight colours would
 * claim these bars were different KINDS of thing when the only thing that
 * differs between them is size.
 *
 * So the ramp is imported from StatsPanel rather than redefined — one palette in
 * the codebase, already validated (`--ordinal`) against BOTH card surfaces. A
 * second, subtly different blue would be the actual design failure here.
 *
 * ─── Reading the marks ─────────────────────────────────────────────────────
 *
 *   · An elapsed period with no focus is the TRACK, never a ramp step: nothing
 *     must never read as a little.
 *   · A day or month still to COME is the track at a third opacity — a
 *     half-finished month should look half-finished, not like a collapse.
 *   · Numbers are labelled selectively. On the seven-column weekday chart the
 *     tallest is direct-labelled; on a thirty-one-column month nothing is,
 *     because a label in an 8pt slot is a truncated label — tap a column and
 *     its figure appears in the card's note instead. That tap is this
 *     platform's tooltip.
 *   · Text always wears the card's ink, never a series colour. The coloured
 *     mark beside it carries the identity.
 */
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Reanimated, { useAnimatedStyle, useSharedValue, withTiming, Easing } from 'react-native-reanimated';

import { tapHaptic } from '../../../utils/haptics';
import { boardLabel } from '../utils/taskHelpers';
import { formatMinutes } from '../utils/focusStats';
import { focusRangeStats, focusRecords } from '../utils/focusRanges';
// One ramp for the whole app's charts — see the note above.
import { RAMP, rampStep } from './StatsPanel';

const RANGE_KEYS = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
  { value: 'all', label: 'All' },
];

/** A mark with nothing in it: the surface one step up, never a ramp step. */
const emptyMark = (pal) => pal.track;
const markColor = (value, max, pal) => {
  const step = rampStep(value, max);
  return step < 0 ? emptyMark(pal) : RAMP[step];
};

const SLIDE_MS = 260;
const SLIDE_EASE = Easing.bezier(0.4, 0, 0.2, 1);

/** "Sat 26 Sep" — short enough for a note line. */
const dayLabel = (ms) =>
  new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

/**
 * The period keys. Same box, same gliding pill as the header's status keys
 * (StatusSegment) — the app has one segmented control and this is it, four
 * keys wide.
 */
function RangeSegment({ value, onChange, theme }) {
  const c = theme.colors;
  const [frames, setFrames] = useState({});
  const pillX = useSharedValue(0);
  const pillW = useSharedValue(0);
  const settled = useRef(false);
  const frame = frames[value];
  useEffect(() => {
    if (!frame) return;
    if (!settled.current) {
      pillX.value = frame.x;
      pillW.value = frame.width;
      settled.current = true;
      return;
    }
    pillX.value = withTiming(frame.x, { duration: SLIDE_MS, easing: SLIDE_EASE });
    pillW.value = withTiming(frame.width, { duration: SLIDE_MS, easing: SLIDE_EASE });
  }, [frame, pillX, pillW]);
  const pillStyle = useAnimatedStyle(() => ({
    width: pillW.value,
    transform: [{ translateX: pillX.value }],
    opacity: pillW.value > 0 ? 1 : 0,
  }));

  return (
    <View style={[styles.segBox, { borderColor: c.borderStrong }]} accessibilityRole="tablist" testID="focus-range-segment">
      <Reanimated.View pointerEvents="none" style={[styles.segPill, { backgroundColor: c.textPrimary }, pillStyle]} />
      {RANGE_KEYS.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onLayout={(e) => {
              const { x, width } = e.nativeEvent.layout;
              setFrames((prev) => (
                prev[o.value] && prev[o.value].x === x && prev[o.value].width === width
                  ? prev
                  : { ...prev, [o.value]: { x, width } }
              ));
            }}
            onPressIn={() => tapHaptic()}
            onPress={() => { if (!on) onChange(o.value); }}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${o.label} focus stats`}
            testID={`focus-range-${o.value}`}
            hitSlop={{ top: 8, bottom: 8 }}
            style={({ pressed }) => [styles.segKey, pressed && !on && styles.pressed]}
          >
            <Text style={[styles.segText, { color: on ? c.background : c.textTertiary }]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A section: a title, an optional one-line note, and the plot under them. */
function Chart({ title, note, children, pal, testID }) {
  return (
    <View
      style={[styles.card, { backgroundColor: pal.card, borderColor: pal.edge, borderTopColor: pal.edgeTop }]}
      testID={testID}
    >
      <Text style={[styles.cardTitle, { color: pal.text }]} numberOfLines={1}>{title}</Text>
      {!!note && <Text style={[styles.cardNote, { color: pal.muted }]} numberOfLines={2}>{note}</Text>}
      {children}
    </View>
  );
}

/** A headline number under a caption. Proportional digits — tabular reads loose here. */
function Figure({ value, caption, pal, icon, accent, testID }) {
  return (
    <View style={styles.figure} testID={testID}>
      <View style={styles.figureTop}>
        {!!icon && <Icon name={icon} size={13} color={accent || pal.muted} />}
        <Text style={[styles.figureCaption, { color: pal.muted }]} numberOfLines={1}>{caption}</Text>
      </View>
      <Text style={[styles.figureValue, { color: pal.text }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

/** One ratio against its whole — a two-slice pie's honest form. */
function Meter({ pct, pal }) {
  return (
    <View style={[styles.meterTrack, { backgroundColor: pal.track }]}>
      <View style={[styles.meterFill, { width: `${Math.max(2, Math.min(100, pct))}%`, backgroundColor: RAMP[2] }]} />
    </View>
  );
}

/**
 * The period's spine, as columns: a day each for a week or month, a month each
 * for a year or for all time.
 *
 * Tap a column to read it. On a 31-column month there is no room to print a
 * figure over a mark, so the tap moves the figure to the card's note — the
 * tooltip this platform actually has. Every column also carries its value in
 * its accessibility label, which is the table view for anyone who needs one.
 */
function Series({ series, pal, picked, onPick, labelled }) {
  const peak = series.points.reduce((m, p) => Math.max(m, p.minutes), 0);
  return (
    <View style={styles.columns} testID="focus-series">
      {series.points.map((p) => {
        const isPicked = picked === p.key;
        const tallest = peak > 0 && p.minutes === peak;
        const h = peak > 0 ? Math.max(3, Math.round((p.minutes / peak) * 78)) : 3;
        return (
          <Pressable
            key={p.key}
            onPress={() => { tapHaptic(); onPick(isPicked ? null : p.key); }}
            style={styles.columnSlot}
            accessibilityRole="button"
            accessibilityLabel={`${series.unit === 'day' ? dayLabel(p.ms) : p.key}, ${formatMinutes(p.minutes)}`}
            testID={`focus-series-${p.key}`}
          >
            {/* Only the seven-wide charts can afford a figure over a mark. */}
            {labelled && (
              <Text
                style={[styles.columnValue, { color: tallest || isPicked ? pal.text : 'transparent' }]}
                numberOfLines={1}
                accessible={false}
              >
                {p.minutes >= 60 ? `${Math.round(p.minutes / 60)}h` : p.minutes}
              </Text>
            )}
            <View
              style={[
                styles.column,
                {
                  height: h,
                  backgroundColor: p.minutes > 0
                    ? markColor(p.minutes, peak, pal)
                    : emptyMark(pal),
                  // Still to come: the track, dimmed. Not a zero — a not-yet.
                  opacity: p.future && p.minutes === 0 ? 0.35 : 1,
                },
                // A picked column gets a ring of surface rather than a
                // different colour: the colour is carrying magnitude already.
                isPicked && { borderWidth: 1.5, borderColor: pal.text },
              ]}
            />
            <Text style={[styles.columnLabel, { color: isPicked ? pal.text : pal.muted }]} numberOfLines={1}>
              {p.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Horizontal bars — the right way round when the labels are words ("Afternoon",
 * a board name) rather than dates. Rounded at the data end only, so the bar
 * reads as growing out of its track.
 */
function Bars({ rows, pal, testID, showShare }) {
  const peak = rows.reduce((m, r) => Math.max(m, r.minutes), 0);
  const total = rows.reduce((s, r) => s + r.minutes, 0);
  return (
    <View testID={testID}>
      {rows.map((r) => (
        <View
          key={r.key || r.label}
          style={styles.barRow}
          accessible
          accessibilityLabel={`${r.label}, ${formatMinutes(r.minutes)}`}
        >
          {/* Name, detail and figure share ONE row: the name takes what it
              needs, the detail takes the slack, the figure holds a fixed
              right-hand column. Nothing here can overset the card. */}
          <View style={styles.barHead}>
            <Text style={[styles.barLabel, { color: pal.sub }]} numberOfLines={1}>{r.label}</Text>
            <Text style={[styles.barCaption, { color: pal.muted }]} numberOfLines={1}>{r.caption || ''}</Text>
            <Text style={[styles.barValue, { color: pal.text }]} numberOfLines={1}>
              {showShare && total > 0 ? `${Math.round((r.minutes / total) * 100)}%` : formatMinutes(r.minutes)}
            </Text>
          </View>
          <View style={[styles.barTrack, { backgroundColor: pal.track }]}>
            <View
              style={[
                styles.bar,
                {
                  width: `${peak > 0 ? Math.max(2, Math.round((r.minutes / peak) * 100)) : 2}%`,
                  backgroundColor: r.minutes > 0 ? markColor(r.minutes, peak, pal) : emptyMark(pal),
                },
              ]}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * The 24-hour strip: a cell per hour, inked by how much focus landed in it.
 *
 * The night hours are kept rather than trimmed — an empty 3am is part of the
 * shape, and a strip that began at your earliest block would rescale itself
 * every time you had an unusual morning.
 */
function HourStrip({ byHour, pal }) {
  const peak = byHour.reduce((m, v) => Math.max(m, v), 0);
  return (
    <View testID="focus-stats-hours">
      <View style={styles.hours}>
        {byHour.map((m, h) => (
          <View
            // eslint-disable-next-line react/no-array-index-key
            key={h}
            style={[styles.hourCell, { backgroundColor: markColor(m, peak, pal) }]}
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

/** "+42% vs last week" / "down 12% vs last month" / "all new". */
function deltaLine(prev) {
  if (!prev) return null;
  if (prev.deltaPct == null) {
    return prev.minutes === 0 ? 'nothing to compare — this is all new' : `vs ${formatMinutes(prev.minutes)} ${prev.label}`;
  }
  if (prev.deltaPct === 0) return `level with ${prev.label}`;
  const dir = prev.deltaPct > 0 ? 'up' : 'down';
  return `${dir} ${Math.abs(prev.deltaPct)}% vs ${prev.label} (${formatMinutes(prev.minutes)})`;
}

function FocusStatsPanel({
  sessions,
  boardOfTask,
  pal,
  theme,
  onClose,
  // Which period the panel opens on — the tile that was tapped to get here.
  initialRange = 'week',
  insetTop = 0,
  bottomInset = 0,
  // Injected in tests; the panel is otherwise anchored to the wall clock.
  nowMs,
}) {
  const c = theme.colors;
  const now = nowMs ?? Date.now();
  const [range, setRange] = useState(initialRange);
  // The column the user tapped, so a chart is something you can interrogate
  // rather than a picture. Cleared when the period changes — a key from the
  // month's spine means nothing on the year's.
  const [picked, setPicked] = useState(null);

  const s = useMemo(() => focusRangeStats(sessions, range, now, boardOfTask), [sessions, range, now, boardOfTask]);
  const records = useMemo(() => focusRecords(sessions), [sessions]);

  const pickedPoint = picked ? s.series.points.find((p) => p.key === picked) : null;
  const peakPoint = s.series.points.reduce((best, p) => (!best || p.minutes > best.minutes ? p : best), null);

  const seriesTitle = s.series.unit === 'day' ? 'By day' : 'By month';
  const seriesNote = pickedPoint
    ? `${s.series.unit === 'day' ? dayLabel(pickedPoint.ms) : pickedPoint.key} · ${formatMinutes(pickedPoint.minutes)}`
    : (peakPoint && peakPoint.minutes > 0
      ? `Best ${s.series.unit === 'day' ? dayLabel(peakPoint.ms) : peakPoint.key} · ${formatMinutes(peakPoint.minutes)} · tap a column`
      : 'Nothing in this period yet');

  return (
    <View style={[styles.page, { backgroundColor: c.background, paddingTop: insetTop }]}>
      <View style={[styles.topBar, { borderBottomColor: c.border }]}>
        <Pressable
          onPress={onClose}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={({ pressed }) => [styles.backKey, pressed && styles.pressed]}
          testID="focus-stats-back"
        >
          <Icon name="chevron-left" size={28} color={c.textPrimary} />
        </Pressable>
        <Text style={[styles.topTitle, { color: c.textPrimary }]} numberOfLines={1}>Focus stats</Text>
        <View style={styles.topRight} />
      </View>

      {/* The period keys, above the charts and outside the scroll — the filter
          row stays put while what it filters scrolls under it. */}
      <View style={styles.segRow}>
        <RangeSegment value={range} onChange={(v) => { setRange(v); setPicked(null); }} theme={theme} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: 32 + bottomInset }]}
        showsVerticalScrollIndicator
        scrollIndicatorInsets={{ right: 1 }}
        indicatorStyle={theme.mode === 'dark' ? 'white' : 'black'}
        testID="focus-stats-scroll"
      >
        {/* The headline. A single total is a NUMBER, not a chart. */}
        <Chart
          title={s.label}
          note={deltaLine(s.prev)}
          pal={pal}
          testID="focus-stats-total"
        >
          <Text style={[styles.hero, { color: pal.text }]} numberOfLines={1} testID="focus-stats-hero">
            {formatMinutes(s.minutes)}
          </Text>
          <View style={styles.figureRow}>
            <Figure
              value={s.blocks}
              caption={s.blocks === 1 ? 'Block' : 'Blocks'}
              icon="timer-outline"
              pal={pal}
              testID="focus-stats-fig-blocks"
            />
            <Figure
              value={s.averageMinutes ? `${s.averageMinutes}m` : '—'}
              caption="Average"
              icon="chart-donut"
              pal={pal}
              testID="focus-stats-fig-average"
            />
            <Figure
              value={s.followThroughPct == null ? '—' : `${s.followThroughPct}%`}
              caption="Seen through"
              icon="check-circle-outline"
              pal={pal}
              testID="focus-stats-fig-follow"
            />
          </View>
          {s.abandoned > 0 && (
            <Text style={[styles.cardFoot, { color: pal.muted }]} numberOfLines={2} testID="focus-stats-abandoned">
              {s.abandoned === 1 ? '1 block' : `${s.abandoned} blocks`} started and left — not counted in the total.
            </Text>
          )}
        </Chart>

        <Chart title={seriesTitle} note={seriesNote} pal={pal} testID="focus-stats-series">
          <Series
            series={s.series}
            pal={pal}
            picked={picked}
            onPick={setPicked}
            // Seven columns can carry a figure; thirty-one cannot.
            labelled={s.series.points.length <= 12}
          />
          {s.series.truncated > 0 && (
            <Text style={[styles.cardFoot, { color: pal.muted }]} numberOfLines={2}>
              Showing the last 24 months — {s.series.truncated} earlier month
              {s.series.truncated === 1 ? '' : 's'} not drawn.
            </Text>
          )}
        </Chart>

        {/* The habit behind the total: not how much, but how OFTEN. */}
        <Chart
          title="Rhythm"
          note={
            s.range === 'all'
              ? `${s.activeDays} day${s.activeDays === 1 ? '' : 's'} with focus on them`
              : `Focus on ${s.activeDays} of the ${s.elapsedDays} day${s.elapsedDays === 1 ? '' : 's'} so far`
          }
          pal={pal}
          testID="focus-stats-rhythm"
        >
          {s.range !== 'all' && (
            <View style={styles.meterWrap}>
              <Meter pct={s.showUpPct} pal={pal} />
            </View>
          )}
          <View style={styles.figureRow}>
            <Figure
              value={formatMinutes(s.perDay)}
              caption={s.range === 'all' ? 'Per active day' : 'Per day'}
              icon="calendar-blank-outline"
              pal={pal}
              testID="focus-stats-fig-perday"
            />
            <Figure
              value={formatMinutes(s.perActiveDay)}
              caption="Days you show up"
              icon="calendar-check-outline"
              pal={pal}
              testID="focus-stats-fig-peractive"
            />
            <Figure
              value={s.longest ? formatMinutes(s.longest.minutes) : '—'}
              caption="Longest block"
              icon="arrow-expand-horizontal"
              pal={pal}
              testID="focus-stats-fig-longest"
            />
          </View>
        </Chart>

        {/* WHEN, as opposed to how much — the question a total cannot answer and
            the one that changes what you do tomorrow. */}
        <Chart
          title="When you focus"
          note={s.peakBand ? `Most of it in the ${s.peakBand.label.toLowerCase()}` : 'Nothing to place yet'}
          pal={pal}
          testID="focus-stats-when"
        >
          <Bars
            rows={s.bands.map((b) => ({ key: b.key, label: b.label, caption: b.caption, minutes: b.minutes }))}
            pal={pal}
            testID="focus-stats-band-bars"
          />
          <View style={styles.hourDivide} />
          <HourStrip byHour={s.byHour} pal={pal} />
        </Chart>

        <Chart
          title="By weekday"
          note={s.bestWeekday ? `${s.bestWeekday} is your day` : 'Nothing to place yet'}
          pal={pal}
          testID="focus-stats-weekday"
        >
          <View style={styles.columns} testID="focus-stats-weekday-cols">
            {(() => {
              const peak = s.byWeekday.reduce((m, d) => Math.max(m, d.minutes), 0);
              return s.byWeekday.map((d) => {
                const h = peak > 0 ? Math.max(3, Math.round((d.minutes / peak) * 74)) : 3;
                return (
                  <View
                    key={d.label}
                    style={styles.columnSlot}
                    accessible
                    accessibilityLabel={`${d.label}, ${formatMinutes(d.minutes)}`}
                  >
                    <Text
                      style={[styles.columnValue, { color: peak > 0 && d.minutes === peak ? pal.text : 'transparent' }]}
                      numberOfLines={1}
                      accessible={false}
                    >
                      {d.minutes >= 60 ? `${Math.round(d.minutes / 60)}h` : d.minutes}
                    </Text>
                    <View
                      style={[
                        styles.column,
                        { height: h, backgroundColor: d.minutes > 0 ? markColor(d.minutes, peak, pal) : emptyMark(pal) },
                      ]}
                    />
                    <Text style={[styles.columnLabel, { color: pal.muted }]} numberOfLines={1}>{d.label}</Text>
                  </View>
                );
              });
            })()}
          </View>
        </Chart>

        <Chart
          title="Where it went"
          note={s.boards.length ? `${s.boards.length} board${s.boards.length === 1 ? '' : 's'} · share of the period` : null}
          pal={pal}
          testID="focus-stats-boards"
        >
          {s.boards.length === 0 ? (
            <Text style={[styles.cardFoot, { color: pal.muted }]}>No focus in this period yet.</Text>
          ) : (
            <Bars
              rows={s.boards.map((b) => ({
                key: b.name,
                label: boardLabel(b.name),
                caption: `${b.sessions === 1 ? '1 block' : `${b.sessions} blocks`} · ${formatMinutes(b.minutes)}`,
                minutes: b.minutes,
              }))}
              pal={pal}
              showShare
              testID="focus-stats-board-bars"
            />
          )}
        </Chart>

        {/* Records are ALL-TIME and say so. A "best ever" that quietly meant
            "best this week" would be the most misleading figure on the page. */}
        <Chart
          title="Records · all time"
          note={records.firstBlockAt ? `Focusing since ${dayLabel(records.firstBlockAt)}` : null}
          pal={pal}
          testID="focus-stats-records"
        >
          <View style={styles.figureRow}>
            <Figure
              value={records.longestStreak ? `${records.longestStreak}d` : '—'}
              caption="Best streak"
              icon="fire"
              accent={records.longestStreak >= 3 ? '#F59E0B' : null}
              pal={pal}
              testID="focus-stats-fig-streak"
            />
            <Figure
              value={records.bestDay ? formatMinutes(records.bestDay.minutes) : '—'}
              caption="Best day"
              icon="trophy-outline"
              pal={pal}
              testID="focus-stats-fig-bestday"
            />
            <Figure
              value={records.longestBlock ? formatMinutes(records.longestBlock.minutes) : '—'}
              caption="Best block"
              icon="arrow-expand-horizontal"
              pal={pal}
              testID="focus-stats-fig-bestblock"
            />
          </View>
          <View style={styles.figureRow}>
            <Figure
              value={formatMinutes(records.totalMinutes)}
              caption="Lifetime focus"
              icon="timer-sand"
              pal={pal}
              testID="focus-stats-fig-lifetime"
            />
            <Figure
              value={records.totalBlocks}
              caption={records.totalBlocks === 1 ? 'Block' : 'Blocks'}
              icon="counter"
              pal={pal}
              testID="focus-stats-fig-lifeblocks"
            />
            <Figure
              value={records.activeDays}
              caption="Days with focus"
              icon="calendar-heart"
              pal={pal}
              testID="focus-stats-fig-activedays"
            />
          </View>
          {!!records.bestDay && (
            <Text style={[styles.cardFoot, { color: pal.muted }]} numberOfLines={1}>
              Your best day was {dayLabel(records.bestDay.ms)}.
            </Text>
          )}
        </Chart>
      </ScrollView>
    </View>
  );
}

export default memo(FocusStatsPanel);

const styles = StyleSheet.create({
  page: { flex: 1 },
  topBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backKey: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  topTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700' },
  topRight: { minWidth: 36 },

  // The filter row: one row, above the charts, full width of the body's gutter
  // so the control lines up with the cards under it.
  segRow: { paddingHorizontal: 16, paddingTop: 12 },
  segBox: { flexDirection: 'row', height: 32, borderRadius: 9, borderWidth: 1, padding: 2, gap: 2 },
  segPill: { position: 'absolute', top: 2, bottom: 2, left: 0, borderRadius: 7 },
  segKey: { flex: 1, paddingHorizontal: 8, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  segText: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.9, textTransform: 'uppercase' },

  body: { paddingHorizontal: 16, paddingTop: 12 },
  card: { borderRadius: 16, borderWidth: 1, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14, marginBottom: 10 },
  cardTitle: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.9, textTransform: 'uppercase' },
  cardNote: { fontSize: 11.5, fontWeight: '600', marginTop: 3, lineHeight: 16 },
  cardFoot: { fontSize: 11.5, fontWeight: '600', marginTop: 10 },

  hero: { fontSize: 40, fontWeight: '800', letterSpacing: -1.2, marginTop: 8 },
  meterWrap: { marginTop: 12 },
  meterTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  meterFill: { height: 6, borderRadius: 3 },

  figureRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  figure: { flex: 1 },
  figureTop: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  figureCaption: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', flexShrink: 1 },
  figureValue: { fontSize: 20, fontWeight: '800', letterSpacing: -0.5, marginTop: 2 },

  // Columns. The slot owns the value label, the mark and the axis label, so the
  // card grows to include the axis band instead of clipping it. A 2px gap of
  // surface between marks — a gap, never a border.
  columns: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, marginTop: 12 },
  columnSlot: { flex: 1, alignItems: 'center' },
  columnValue: { fontSize: 10, fontWeight: '700', marginBottom: 3 },
  // Anchored to the baseline, rounded at the DATA end only.
  column: { width: '100%', borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  columnLabel: { fontSize: 9, fontWeight: '600', marginTop: 5 },

  barRow: { marginTop: 12 },
  barHead: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  barLabel: { flexShrink: 1, fontSize: 12.5, fontWeight: '700' },
  // Takes the slack between the name and the figure, and gives it back when
  // the name is long.
  barCaption: { flex: 1, fontSize: 10.5, fontWeight: '600', textAlign: 'right' },
  barValue: { minWidth: 42, textAlign: 'right', fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
  barTrack: { height: 8, borderRadius: 4, overflow: 'hidden', marginTop: 5 },
  // Rounded at the data end only, so the bar grows out of its track.
  bar: { height: 8, borderTopRightRadius: 4, borderBottomRightRadius: 4 },

  hourDivide: { height: 16 },
  hours: { flexDirection: 'row', gap: 2, height: 26 },
  hourCell: { flex: 1, borderRadius: 2 },
  hourScale: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  hourTick: { fontSize: 9.5, fontWeight: '700' },

  pressed: { opacity: 0.6 },
});
