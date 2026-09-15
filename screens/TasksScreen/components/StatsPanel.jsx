/**
 * StatsPanel — the Overview's stats page: what the work has actually looked
 * like, as charts, on the same inset cards as everything else.
 *
 * ─── Why every chart here is made of Views ─────────────────────────────────
 *
 * There is no react-native-svg in this app, and adding one is a NATIVE
 * dependency: it moves the runtime fingerprint, so it cannot reach the
 * installed build over the air. That rules out paths, curves and arcs — no
 * line charts, no donuts — and leaves rectangles: bars, columns, stacked
 * tracks, heat cells. Which is not much of a loss, because rectangles are what
 * these questions want anyway (see the form table in the dataviz reference:
 * magnitude → bar/heatmap; part-to-whole → stacked bar; a single ratio →
 * meter). A donut would have been the wrong form even if it were free.
 *
 * ─── The palette, and why it is one hue ────────────────────────────────────
 *
 * Every chart here encodes MAGNITUDE — how much got done, where the open work
 * sits. That is a sequential job, so it takes one hue, light→dark, and never a
 * categorical set: eight colours would say "these are different KINDS" when
 * the only thing that differs is size. The four steps are the reference blue
 * ramp's 550/450/350/250, validated (`scripts/validate_palette.js --ordinal`)
 * against BOTH card surfaces — #1F2024 on the light page and #17171A on the
 * dark one — for monotone lightness, ≥0.06 step gaps, single hue, and the
 * light end clearing the surface. Both pass.
 *
 * LATE IS THE ONE EXCEPTION and it is not a series: it is a status colour, so
 * it never appears without the word "late" beside it.
 *
 * Text takes the card's ink (`pal.text` / `sub` / `muted`), never a series
 * colour — a coloured mark next to plain text carries the identity.
 */
import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { taskStats } from '../utils/taskStats';
import { boardLabel } from '../utils/taskHelpers';

/**
 * Sequential ramp, low→high. Dark end recedes toward the charcoal card, light
 * end stands off it. Validated as an ordinal ramp on both card surfaces.
 */
export const RAMP = ['#1c5cab', '#2a78d6', '#5598e7', '#86b6ef'];
/** Status, not a series — always shipped with the word "late". */
const LATE = '#F87171';
/** A cell/bar with nothing in it: the surface, one step up. Never a ramp step. */
const emptyMark = (pal) => pal.track;

/** Which ramp step a value lands on. 0 → the empty mark, not step 0. */
export function rampStep(value, max) {
  if (!value || value <= 0) return -1;
  if (!max || max <= 0) return -1;
  // Four bands over the observed range, so the busiest day is always the
  // lightest step and a single completion is always visible.
  const band = Math.ceil((value / max) * RAMP.length);
  return Math.min(RAMP.length - 1, Math.max(0, band - 1));
}

const markColor = (value, max, pal) => {
  const step = rampStep(value, max);
  return step < 0 ? emptyMark(pal) : RAMP[step];
};

/** A section: a title, an optional one-line note, and the plot under them. */
function Chart({ title, note, children, pal, testID }) {
  return (
    <View style={[styles.card, { backgroundColor: pal.card, borderColor: pal.edge, borderTopColor: pal.edgeTop }]} testID={testID}>
      <Text style={[styles.cardTitle, { color: pal.text }]} numberOfLines={1}>{title}</Text>
      {!!note && <Text style={[styles.cardNote, { color: pal.muted }]} numberOfLines={2}>{note}</Text>}
      {children}
    </View>
  );
}

/** A headline number. Proportional figures, never tabular — at this size
 *  equal-width digits make a number look loose. */
function Figure({ value, caption, pal, accent, icon, testID }) {
  return (
    <View style={styles.figure} testID={testID}>
      <View style={styles.figureTop}>
        {!!icon && <Icon name={icon} size={14} color={accent || pal.muted} />}
        <Text style={[styles.figureCaption, { color: pal.muted }]} numberOfLines={1}>{caption}</Text>
      </View>
      <Text style={[styles.figureValue, { color: accent || pal.text }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

/**
 * The completion meter: one ratio against its whole, on the same ramp as
 * everything else. A two-slice pie's honest form.
 */
function Meter({ pct, pal }) {
  return (
    <View style={styles.meterWrap}>
      <View style={[styles.meterTrack, { backgroundColor: pal.track }]}>
        <View style={[styles.meterFill, { width: `${Math.max(2, Math.min(100, pct))}%`, backgroundColor: RAMP[2] }]} />
      </View>
    </View>
  );
}

/**
 * Columns. One series, so no legend — the title names it. Only the tallest
 * column is direct-labelled: a number over every column goes unread.
 */
function Columns({ data, max, pal, testID }) {
  return (
    <View style={styles.columns} testID={testID}>
      {data.map((d, i) => {
        const tallest = max > 0 && d.count === max;
        const h = max > 0 ? Math.max(3, Math.round((d.count / max) * 74)) : 3;
        return (
          <View key={`${d.label}-${i}`} style={styles.columnSlot}>
            <Text
              style={[styles.columnValue, { color: tallest ? pal.text : 'transparent' }]}
              numberOfLines={1}
              accessible={false}
            >
              {d.count}
            </Text>
            {/* Anchored to the baseline, rounded at the data end only. */}
            <View style={[styles.column, { height: h, backgroundColor: d.count > 0 ? markColor(d.count, max, pal) : emptyMark(pal) }]} />
            <Text style={[styles.columnLabel, { color: pal.muted }]} numberOfLines={1}>{d.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

/**
 * The activity grid — a week per column, a day per cell, oldest at the left.
 * Sequential: the darker the cell, the fewer; an empty day is the track, not a
 * ramp step, so "nothing" never reads as "a little".
 */
function Heatmap({ heat, max, pal, testID }) {
  // Columns of 7, oldest first. The last column is the week we are in.
  const cols = [];
  for (let i = 0; i < heat.length; i += 7) cols.push(heat.slice(i, i + 7));
  return (
    <View style={styles.heatWrap} testID={testID}>
      <View style={styles.heatGrid}>
        {cols.map((col, ci) => (
          <View key={ci} style={styles.heatCol}>
            {col.map((cell) => (
              <View
                key={cell.day}
                style={[styles.heatCell, { backgroundColor: markColor(cell.count, max, pal) }]}
              />
            ))}
          </View>
        ))}
      </View>
      <View style={styles.legendRow}>
        <Text style={[styles.legendText, { color: pal.muted }]}>Less</Text>
        <View style={[styles.legendSwatch, { backgroundColor: emptyMark(pal) }]} />
        {RAMP.map((c) => <View key={c} style={[styles.legendSwatch, { backgroundColor: c }]} />)}
        <Text style={[styles.legendText, { color: pal.muted }]}>More</Text>
      </View>
    </View>
  );
}

/** Horizontal bars — the right way round for long board names. */
function Bars({ rows, max, pal, testID }) {
  return (
    <View testID={testID}>
      {rows.map((r) => {
        const name = r.name === '__other__'
          ? `Other · ${r.otherOf} board${r.otherOf === 1 ? '' : 's'}`
          : boardLabel(r.name || '');
        return (
          <View key={r.name || 'none'} style={styles.barRow}>
            <Text style={[styles.barLabel, { color: pal.sub }]} numberOfLines={1}>{name}</Text>
            <View style={styles.barTrackWrap}>
              <View
                style={[
                  styles.bar,
                  {
                    width: `${max > 0 ? Math.max(3, Math.round((r.count / max) * 100)) : 3}%`,
                    backgroundColor: markColor(r.count, max, pal),
                  },
                ]}
              />
            </View>
            <Text style={[styles.barValue, { color: pal.text }]} numberOfLines={1}>{r.count}</Text>
          </View>
        );
      })}
    </View>
  );
}

function StatsPanel({ tasks, todayStr, pal, theme, onClose, insetTop = 0, bottomInset = 0 }) {
  const c = theme.colors;
  const s = useMemo(() => taskStats(tasks, todayStr), [tasks, todayStr]);

  const weekData = s.weeks.map((w) => ({ label: w.end.slice(5).replace('-', '/'), count: w.count }));
  const coverage = s.undatedDone > 0
    ? `Of ${s.done} finished, ${s.datedCompletions} carry a completion date — the charts below count those.`
    : null;

  return (
    <View style={[styles.page, { backgroundColor: c.background, paddingTop: insetTop }]}>
      <View style={[styles.topBar, { borderBottomColor: c.border }]}>
        <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back" style={({ pressed }) => [styles.backKey, pressed && styles.pressed]}>
          <Icon name="chevron-left" size={28} color={c.textPrimary} />
        </Pressable>
        <Text style={[styles.topTitle, { color: c.textPrimary }]} numberOfLines={1}>Stats</Text>
        <View style={styles.topRight} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: 32 + bottomInset }]}
        showsVerticalScrollIndicator
        scrollIndicatorInsets={{ right: 1 }}
        indicatorStyle={theme.mode === 'dark' ? 'white' : 'black'}
        testID="stats-scroll"
      >
        {/* The headline: a ratio, which is a meter — not a two-slice pie. */}
        <Chart title="Completion" note={`${s.done} of ${s.total} tasks done`} pal={pal} testID="stats-completion">
          <Text style={[styles.hero, { color: pal.text }]} numberOfLines={1}>{s.completionPct}%</Text>
          <Meter pct={s.completionPct} pal={pal} />
          <View style={styles.figureRow}>
            <Figure value={s.open} caption="To do" pal={pal} testID="stats-fig-open" />
            <Figure value={s.late} caption="Late" pal={pal} accent={s.late > 0 ? LATE : null} icon={s.late > 0 ? 'alert-circle-outline' : null} testID="stats-fig-late" />
            <Figure value={s.streak} caption={s.streak === 1 ? 'Day streak' : 'Day streak'} pal={pal} icon="fire" testID="stats-fig-streak" />
          </View>
        </Chart>

        <Chart
          title="Activity"
          note={coverage || 'Tasks completed per day, last 13 weeks'}
          pal={pal}
          testID="stats-heatmap"
        >
          <Heatmap heat={s.heat} max={s.heatMax} pal={pal} testID="stats-heat-grid" />
          {!!s.busiestDay && (
            <Text style={[styles.cardFoot, { color: pal.muted }]} numberOfLines={1}>
              Busiest day {s.busiestDay.day.slice(5)} · {s.busiestDay.count} done
            </Text>
          )}
        </Chart>

        <Chart title="Finished per week" note={`${s.weekAverage} a week on average`} pal={pal} testID="stats-weeks">
          <Columns data={weekData} max={s.weekMax} pal={pal} testID="stats-week-cols" />
        </Chart>

        <Chart
          title="By weekday"
          note={s.bestWeekday ? `${s.bestWeekday.label} is the day most gets finished` : 'Nothing dated yet'}
          pal={pal}
          testID="stats-weekdays"
        >
          <Columns data={s.weekdays} max={s.weekdayMax} pal={pal} testID="stats-weekday-cols" />
        </Chart>

        <Chart title="Open work by board" note={`${s.open} still to do`} pal={pal} testID="stats-boards">
          {s.boards.length === 0
            ? <Text style={[styles.cardFoot, { color: pal.muted }]}>Nothing open. All clear.</Text>
            : <Bars rows={s.boards} max={s.boardMax} pal={pal} testID="stats-board-bars" />}
        </Chart>

        {!!s.oldestOpen && (
          <Chart title="Waiting longest" pal={pal} testID="stats-oldest">
            <Text style={[styles.oldestTitle, { color: pal.text }]} numberOfLines={2}>{s.oldestOpen.title}</Text>
            <View style={styles.oldestRow}>
              <Icon name="alert-circle-outline" size={14} color={LATE} />
              <Text style={[styles.oldestMeta, { color: LATE }]} numberOfLines={1}>
                {s.oldestOpen.daysLate} day{s.oldestOpen.daysLate === 1 ? '' : 's'} late · due {s.oldestOpen.dueDate.slice(5)}
              </Text>
            </View>
          </Chart>
        )}
      </ScrollView>
    </View>
  );
}

export default React.memo(StatsPanel);

const styles = StyleSheet.create({
  page: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  backKey: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  topTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700' },
  topRight: { minWidth: 36 },
  body: { paddingHorizontal: 16, paddingTop: 14 },
  card: { borderRadius: 16, borderWidth: 1, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14, marginBottom: 10 },
  cardTitle: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.9, textTransform: 'uppercase' },
  cardNote: { fontSize: 11.5, fontWeight: '600', marginTop: 3, lineHeight: 16 },
  cardFoot: { fontSize: 11.5, fontWeight: '600', marginTop: 10 },
  // Proportional figures on the hero — tabular digits read loose at this size.
  hero: { fontSize: 40, fontWeight: '800', letterSpacing: -1.2, marginTop: 8 },
  meterWrap: { marginTop: 8 },
  meterTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  meterFill: { height: 6, borderRadius: 3 },
  figureRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  figure: { flex: 1 },
  figureTop: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  figureCaption: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', flexShrink: 1 },
  figureValue: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5, marginTop: 2 },
  // Columns: the slot owns the value label, the bar and the axis label, so the
  // card grows to include the axis band instead of clipping it.
  columns: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, marginTop: 12 },
  columnSlot: { flex: 1, alignItems: 'center' },
  columnValue: { fontSize: 10, fontWeight: '700', marginBottom: 3 },
  column: { width: '100%', borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  columnLabel: { fontSize: 9, fontWeight: '600', marginTop: 5 },
  heatWrap: { marginTop: 12 },
  // 2px gaps of surface between cells — a gap, never a border.
  heatGrid: { flexDirection: 'row', gap: 2 },
  heatCol: { flex: 1, gap: 2 },
  heatCell: { width: '100%', aspectRatio: 1, borderRadius: 2 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10 },
  legendSwatch: { width: 10, height: 10, borderRadius: 2 },
  legendText: { fontSize: 9.5, fontWeight: '600' },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  barLabel: { width: 96, fontSize: 12, fontWeight: '600' },
  barTrackWrap: { flex: 1 },
  bar: { height: 8, borderRadius: 4 },
  barValue: { width: 26, textAlign: 'right', fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  oldestTitle: { fontSize: 15, fontWeight: '600', marginTop: 8 },
  oldestRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 },
  oldestMeta: { fontSize: 12, fontWeight: '600' },
  pressed: { opacity: 0.6 },
});
