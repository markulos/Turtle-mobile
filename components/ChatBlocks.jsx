/**
 * ChatBlocks — the interactive half of an assistant reply, on the phone.
 *
 * A reply can now arrive with a small board attached: buttons, list rows, a
 * checklist, a row of figures, a short form (server: `services/aiBlocks.js`).
 * This draws them under the bubble and runs what gets tapped.
 *
 * ─── The vocabulary is closed ───────────────────────────────────────────────
 *
 * The server sends no markup and no styling — only a typed structure it rebuilt
 * from scratch from a fixed set of kinds. This file draws the ones it knows and
 * ignores the rest, so "the assistant can put UI in the chat" never becomes
 * "the assistant can put anything in the chat". An unrecognised kind renders as
 * nothing, which is also what makes the field safe to grow: this app is allowed
 * to be older than the pond it is talking to.
 *
 * ─── Two presses for anything that changes data ─────────────────────────────
 *
 * A `call` action arrives with `confirm` and `effect` decided server-side from
 * the resolved route — NOT from the label, which the assistant wrote. When
 * `confirm` is set the first press only arms the button: it reveals what the
 * call actually is and swaps in a deliberate Confirm/Cancel pair. The server
 * refuses an unconfirmed write anyway (428), so this is the honest face of a
 * rule enforced whether or not the client is polite.
 *
 * The failure that makes this worth the extra press is specific: text injected
 * into somebody's shared note could ask for a button labelled "Show more" that
 * deletes an album. Label and effect come from different parties, and arming
 * shows both — so a mislabelled button is a visible lie rather than a silent
 * one. Same reasoning as `ApiProposalCard`, which puts the whole request on
 * screen for exactly this reason.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import {
  drawableBlocks,
  mergeFormBody,
  missingRequired,
  tabForScreen,
} from '../utils/chatBlocks';

export default function ChatBlocks({ blocks, theme, api, onAsk, onNavigate }) {
  const drawable = useMemo(() => drawableBlocks(blocks), [blocks]);

  // Keyed by action id, which the server made unique within a turn.
  const [results, setResults] = useState({});
  // Form inputs, keyed `${blockId}.${fieldName}`, seeded from what the
  // assistant already worked out so the user corrects rather than retypes.
  const [values, setValues] = useState(() => {
    const seed = {};
    for (const block of drawable) {
      for (const field of block.fields || []) {
        if (field?.value != null) seed[`${block.id}.${field.name}`] = String(field.value);
      }
    }
    return seed;
  });
  // Checklist ticks move optimistically and move back on failure — a checkbox
  // that waits for a round trip reads as broken.
  const [checked, setChecked] = useState(() => {
    const seed = {};
    for (const block of drawable) {
      if (block.kind !== 'checklist') continue;
      for (const item of block.items || []) seed[item.id] = item.checked === true;
    }
    return seed;
  });

  const styles = useMemo(() => makeStyles(theme), [theme]);
  const c = theme.colors;

  const setResult = useCallback((id, result) => {
    setResults((prev) => ({ ...prev, [id]: result }));
  }, []);

  /**
   * Run one action.
   *
   * `call` goes through `/turtle/chat/action` rather than straight at the
   * endpoint. That costs a hop and buys the thing three separate clients would
   * otherwise each have to get right: the server re-derives the risk from its
   * own router and refuses anything that outgrew what it originally offered.
   * `confirmed` is this client stating the user took the second press.
   */
  const run = useCallback(async (action, bodyOverride) => {
    if (action.kind === 'ask') {
      onAsk?.(action.text || action.label);
      setResult(action.id, { state: 'done', message: 'Asked' });
      return true;
    }

    if (action.kind === 'open') {
      const tab = tabForScreen(action.screen);
      if (!tab) {
        setResult(action.id, { state: 'error', message: 'That screen isn\'t in this app.' });
        return false;
      }
      onNavigate?.(tab, action.params);
      return true;
    }

    setResult(action.id, { state: 'running' });
    try {
      const res = await api.post('/turtle/chat/action', {
        action: {
          kind: 'call',
          label: action.label,
          method: action.method,
          path: action.path,
          query: action.query,
          body: bodyOverride ?? action.body,
          confirmed: action.confirm === true,
        },
      });
      if (res && res.success === false) {
        setResult(action.id, { state: 'error', message: res.error || 'That didn\'t go through.' });
        return false;
      }
      setResult(action.id, {
        state: 'done',
        message: action.risk === 'read' ? 'Done' : 'Done — saved',
      });
      return true;
    } catch (error) {
      // The server's own message, not a generic one — it is the only text that
      // says what actually went wrong.
      setResult(action.id, { state: 'error', message: String(error?.message || 'That didn\'t go through.') });
      return false;
    }
  }, [api, onAsk, onNavigate, setResult]);

  /** First press on a confirm-required action arms it; the second runs it. */
  const press = useCallback((action, bodyOverride) => {
    const state = results[action.id]?.state ?? 'idle';
    if (state === 'running' || state === 'done') return;
    if (action.kind === 'call' && action.confirm && state !== 'armed') {
      setResult(action.id, { state: 'armed' });
      return;
    }
    run(action, bodyOverride);
  }, [results, run, setResult]);

  if (!drawable.length) return null;

  const renderAction = (action, block) => {
    const result = results[action.id] ?? { state: 'idle' };
    const armed = result.state === 'armed';
    const running = result.state === 'running';
    const done = result.state === 'done';
    const failed = result.state === 'error';

    const danger = action.style === 'danger';
    const tint = danger ? (c.accentError || '#F87171') : (c.accent || c.accentInfo);

    // A form's submit stays disabled until its required fields are filled. The
    // alternative is a round trip that comes back as the server's 400 — the
    // same information, several seconds later and phrased as a failure.
    const fields = block?.kind === 'form' ? (block.fields || []) : [];
    const formValues = Object.fromEntries(
      fields.map((f) => [f.name, values[`${block.id}.${f.name}`] ?? '']),
    );
    const missing = fields.length ? missingRequired(fields, formValues) : [];
    const blocked = missing.length > 0;
    const bodyOverride = fields.length ? mergeFormBody(fields, formValues, action.body) : undefined;

    return (
      <View key={action.id} style={styles.actionWrap}>
        <View style={styles.actionRow}>
          <TouchableOpacity
            disabled={running || done || blocked}
            onPress={() => press(action, bodyOverride)}
            accessibilityRole="button"
            // The label spells the effect out, so a screen-reader user gets the
            // same warning the arming step gives everyone else.
            accessibilityLabel={armed && action.effect ? `Confirm: ${action.effect}` : action.label}
            accessibilityState={{ disabled: running || done || blocked }}
            style={[
              styles.button,
              armed && { backgroundColor: tint, borderColor: tint },
              (danger || action.style === 'primary') && !armed && { borderColor: tint },
              (blocked || done) && styles.buttonMuted,
            ]}
          >
            {running && <ActivityIndicator size="small" color={tint} />}
            {done && <Icon name="check" size={14} color={c.accentSuccess || '#34D399'} />}
            {failed && <Icon name="alert-circle-outline" size={14} color={c.accentError || '#F87171'} />}
            <Text
              style={[
                styles.buttonText,
                armed && { color: c.onPrimary || '#000' },
                !armed && (danger || action.style === 'primary') && { color: tint },
                done && { color: c.textTertiary },
              ]}
              numberOfLines={2}
            >
              {armed ? `Yes — ${action.label}` : action.label}
            </Text>
          </TouchableOpacity>

          {armed && (
            <TouchableOpacity
              onPress={() => setResult(action.id, { state: 'idle' })}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              style={styles.cancel}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* The real effect, shown at the moment it matters — computed by the
            server from the resolved route, not from the label above it. */}
        {armed && !!action.effect && <Text style={styles.effect}>{action.effect}</Text>}
        {blocked && <Text style={styles.hint}>Fill in: {missing.join(', ')}</Text>}
        {failed && !!result.message && <Text style={styles.error}>{result.message}</Text>}
        {done && !!result.message && <Text style={styles.hint}>{result.message}</Text>}
      </View>
    );
  };

  const renderBlock = (block) => {
    switch (block.kind) {
      case 'note':
        return (
          <View key={block.id} style={styles.card}>
            {!!block.title && <Text style={styles.cardTitle}>{block.title}</Text>}
            {!!block.body && <Text style={styles.noteBody}>{block.body}</Text>}
          </View>
        );

      case 'stats':
        return (
          <View key={block.id} style={styles.card}>
            {!!block.title && <Text style={styles.cardTitle}>{block.title}</Text>}
            <View style={styles.statsRow}>
              {(block.items || []).map((item) => (
                <View key={item.id} style={styles.stat}>
                  <Text style={styles.statValue}>{item.value}</Text>
                  <Text style={styles.statLabel}>{item.label}</Text>
                  {!!item.hint && <Text style={styles.statHint}>{item.hint}</Text>}
                </View>
              ))}
            </View>
          </View>
        );

      case 'list':
        return (
          <View key={block.id} style={styles.card}>
            {!!block.title && <Text style={styles.cardTitle}>{block.title}</Text>}
            {(block.items || []).map((item) => (
              <View key={item.id} style={styles.listItem}>
                <View style={styles.listHead}>
                  <Text style={styles.listTitle} numberOfLines={2}>{item.title}</Text>
                  {!!item.badge && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{item.badge}</Text>
                    </View>
                  )}
                </View>
                {!!item.subtitle && <Text style={styles.listSubtitle} numberOfLines={3}>{item.subtitle}</Text>}
                {!!item.actions?.length && (
                  <View style={styles.actionsRow}>
                    {item.actions.map((action) => renderAction(action))}
                  </View>
                )}
              </View>
            ))}
          </View>
        );

      case 'actions':
        return (
          <View key={block.id} style={styles.card}>
            {!!block.title && <Text style={styles.cardTitle}>{block.title}</Text>}
            <View style={styles.actionsRow}>
              {(block.actions || []).map((action) => renderAction(action))}
            </View>
          </View>
        );

      case 'checklist':
        return (
          <View key={block.id} style={styles.card}>
            {!!block.title && <Text style={styles.cardTitle}>{block.title}</Text>}
            {(block.items || []).map((item) => {
              const isChecked = checked[item.id] === true;
              const action = item.action;
              const state = action ? (results[action.id]?.state ?? 'idle') : 'idle';
              const busy = state === 'running';
              // A row whose action changes data can't tick silently — it falls
              // back to the armed button underneath, same as anywhere else.
              const needsConfirm = action?.kind === 'call' && action.confirm === true && state !== 'armed';
              return (
                <View key={item.id}>
                  <TouchableOpacity
                    disabled={busy || !action}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: isChecked, disabled: busy || !action }}
                    accessibilityLabel={item.label}
                    onPress={() => {
                      if (!action) return;
                      if (needsConfirm) { setResult(action.id, { state: 'armed' }); return; }
                      const next = !isChecked;
                      setChecked((prev) => ({ ...prev, [item.id]: next }));
                      run(action).then((ok) => {
                        if (!ok) setChecked((prev) => ({ ...prev, [item.id]: !next }));
                      });
                    }}
                    style={styles.checkRow}
                  >
                    <View style={[styles.box, isChecked && { backgroundColor: c.accent || c.accentInfo, borderColor: c.accent || c.accentInfo }]}>
                      {busy
                        ? <ActivityIndicator size="small" color={c.accent || c.accentInfo} />
                        : isChecked
                          ? <Icon name="check" size={12} color={c.onPrimary || '#000'} />
                          : null}
                    </View>
                    <Text style={[styles.checkLabel, isChecked && styles.checkLabelDone]} numberOfLines={3}>
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                  {action && state === 'armed' && (
                    <View style={styles.checkArmed}>{renderAction(action)}</View>
                  )}
                  {action && state === 'error' && !!results[action.id]?.message && (
                    <Text style={[styles.error, styles.checkArmed]}>{results[action.id].message}</Text>
                  )}
                </View>
              );
            })}
          </View>
        );

      case 'form':
        return (
          <View key={block.id} style={styles.card}>
            {!!block.title && <Text style={styles.cardTitle}>{block.title}</Text>}
            {(block.fields || []).map((field) => {
              const key = `${block.id}.${field.name}`;
              return (
                <View key={field.id} style={styles.field}>
                  <Text style={styles.fieldLabel}>
                    {field.label}{field.required ? ' *' : ''}
                  </Text>
                  {field.type === 'select' ? (
                    // No native picker here on purpose: a handful of options
                    // reads better as chips than as a modal wheel, and it keeps
                    // this component free of another dependency.
                    <View style={styles.options}>
                      {(field.options || []).map((option) => {
                        const active = (values[key] ?? '') === option.value;
                        return (
                          <TouchableOpacity
                            key={option.value}
                            onPress={() => setValues((prev) => ({ ...prev, [key]: active ? '' : option.value }))}
                            accessibilityRole="radio"
                            accessibilityState={{ selected: active }}
                            style={[styles.option, active && { borderColor: c.accent || c.accentInfo }]}
                          >
                            <Text style={[styles.optionText, active && { color: c.accent || c.accentInfo }]}>
                              {option.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ) : (
                    <TextInput
                      value={values[key] ?? ''}
                      onChangeText={(text) => setValues((prev) => ({ ...prev, [key]: text }))}
                      placeholder={field.placeholder || ''}
                      placeholderTextColor={c.textMuted}
                      keyboardType={field.type === 'number' ? 'numeric' : 'default'}
                      multiline={field.type === 'textarea'}
                      accessibilityLabel={field.label}
                      style={[styles.input, field.type === 'textarea' && styles.inputMulti]}
                    />
                  )}
                </View>
              );
            })}
            {block.submit && renderAction(block.submit, block)}
          </View>
        );

      default:
        return null;
    }
  };

  return <View style={styles.board}>{drawable.map(renderBlock)}</View>;
}

const makeStyles = (theme) => {
  const c = theme.colors;
  return StyleSheet.create({
    // Matches ApiProposalCard's footprint so the two confirm affordances read
    // as the same family rather than as two unrelated widgets.
    //
    // `width`, NOT `maxWidth`. A maxWidth is only a cap: with alignSelf
    // flex-start the board still shrink-wraps, so its real width comes from
    // whatever its content reports it needs. That is fine for a card full of
    // text and catastrophic for a checklist, whose labels are `flex: 1,
    // minWidth: 0` and therefore report an intrinsic width of ZERO. The board
    // then collapsed to the widest thing that did have an intrinsic width —
    // the "OPEN TASKS" title — and every task label wrapped to three
    // characters a line inside it. A definite width takes content measurement
    // out of the question entirely.
    board: { alignSelf: 'flex-start', width: '92%', gap: 6, marginBottom: theme.spacing.xs },

    card: {
      backgroundColor: c.surface,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      padding: 12,
      gap: 8,
    },
    cardTitle: {
      fontSize: 10.5,
      fontWeight: '800',
      letterSpacing: 0.5,
      textTransform: 'uppercase',
      color: c.textTertiary,
    },
    noteBody: { fontSize: 13.5, lineHeight: 19, color: c.textSecondary },

    statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
    stat: { minWidth: 64 },
    statValue: { fontSize: 19, fontWeight: '800', color: c.textPrimary },
    statLabel: { fontSize: 11, color: c.textSecondary },
    statHint: { fontSize: 10, color: c.textMuted },

    listItem: { gap: 4 },
    listHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    listTitle: { flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: '700', color: c.textPrimary },
    listSubtitle: { fontSize: 11.5, lineHeight: 16, color: c.textSecondary },
    badge: {
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: 4,
      backgroundColor: c.surfaceElevated,
    },
    badgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.3, color: c.textTertiary, textTransform: 'uppercase' },

    actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    actionWrap: { gap: 3 },
    actionRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    button: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 9,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.surfaceElevated,
    },
    buttonMuted: { opacity: 0.55 },
    buttonText: { fontSize: 12.5, fontWeight: '700', color: c.textPrimary },
    cancel: { paddingHorizontal: 10, paddingVertical: 8 },
    cancelText: { fontSize: 12.5, fontWeight: '600', color: c.textSecondary },

    effect: { fontSize: 11, lineHeight: 15, color: c.textTertiary },
    hint: { fontSize: 11, color: c.textMuted },
    error: { fontSize: 11, lineHeight: 15, color: c.accentError || '#F87171' },

    checkRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 5 },
    checkArmed: { paddingLeft: 25 },
    box: {
      width: 18,
      height: 18,
      borderRadius: 5,
      borderWidth: 1.5,
      borderColor: c.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkLabel: { flex: 1, minWidth: 0, fontSize: 13.5, lineHeight: 18, color: c.textPrimary },
    checkLabelDone: { color: c.textTertiary, textDecorationLine: 'line-through' },

    field: { gap: 4 },
    fieldLabel: { fontSize: 11, color: c.textSecondary },
    input: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      borderRadius: 9,
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontSize: 13.5,
      color: c.textPrimary,
      backgroundColor: c.surfaceElevated,
    },
    inputMulti: { minHeight: 66, textAlignVertical: 'top' },
    options: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    option: {
      paddingHorizontal: 11,
      paddingVertical: 6,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.surfaceElevated,
    },
    optionText: { fontSize: 12, fontWeight: '600', color: c.textSecondary },
  });
};
