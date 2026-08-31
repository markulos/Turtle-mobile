/**
 * ApiProposalCard — the confirm step for something the assistant wants to do.
 *
 * The assistant reads the pond freely, but a change is proposed rather than
 * performed (server: `services/aiTools.js`). This card is where that proposal
 * becomes a decision: it names the change in a sentence, shows the fields
 * being sent, and puts the action behind a deliberate press.
 *
 * ─── Why the whole request is on screen ─────────────────────────────────────
 *
 * The tempting design is a tidy "Add task 'Buy milk'? [Yes] [No]". The problem
 * is that the sentence is written from the same model-supplied object as the
 * request, so a confident-looking sentence is not evidence the request matches
 * it. Showing the method, the path and the fields costs three lines and makes
 * the card auditable: what you approve is what gets sent.
 *
 * A destructive proposal is tinted with the error colour and its button says
 * what it deletes. Same reasoning as the fields — the difference between
 * updating a task and deleting one should be visible before the press, not
 * discoverable after it.
 */
import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { fieldsOf, hiddenFieldCount, summarise } from '../utils/apiProposal';

export default function ApiProposalCard({ proposal, theme, onConfirm, onDismiss }) {
  const c = theme.colors;
  // 'pending' → 'running' → 'done' | 'failed' | 'dismissed'. Held here rather
  // than in the chat's message list because it is the card's own lifecycle;
  // the transcript only needs to know the outcome.
  const [state, setState] = useState('pending');
  const [outcome, setOutcome] = useState('');

  if (!proposal) return null;

  const destructive = proposal.risk === 'destructive';
  const tint = destructive ? (c.accentError || '#F87171') : (c.accent || c.accentInfo);
  const styles = makeStyles(theme, tint);
  const fields = fieldsOf(proposal);
  const hidden = hiddenFieldCount(proposal);

  const run = async () => {
    setState('running');
    try {
      const result = await onConfirm(proposal);
      setState('done');
      setOutcome(typeof result === 'string' && result ? result : 'Done.');
    } catch (error) {
      setState('failed');
      // The server's own message, not a generic one — it is the only text that
      // says what actually went wrong, and the user is the one who has to act.
      setOutcome(String(error?.message || 'That did not go through.'));
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <Icon
          name={destructive ? 'alert-octagon-outline' : 'shield-check-outline'}
          size={18}
          color={tint}
        />
        <Text style={styles.title} numberOfLines={2}>{summarise(proposal)}</Text>
      </View>

      {!!proposal.reason && <Text style={styles.reason}>{proposal.reason}</Text>}

      <View style={styles.requestRow}>
        <Text style={styles.method}>{proposal.method}</Text>
        <Text style={styles.path} numberOfLines={2}>{proposal.path}</Text>
      </View>

      {fields.length > 0 && (
        <View style={styles.fields}>
          {fields.map((field) => (
            <Text key={field.key} style={styles.field} numberOfLines={2}>
              <Text style={styles.fieldKey}>{field.key}</Text>
              {`  ${field.value}`}
            </Text>
          ))}
          {hidden > 0 && (
            <Text style={styles.footnote}>
              …and {hidden} more field{hidden === 1 ? '' : 's'} not shown.
            </Text>
          )}
        </View>
      )}

      {state === 'pending' && (
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.secondary}
            onPress={() => { setState('dismissed'); onDismiss?.(proposal); }}
            accessibilityRole="button"
            accessibilityLabel="Don't do this"
          >
            <Text style={styles.secondaryText}>No</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.primary}
            onPress={run}
            accessibilityRole="button"
            // The label spells the action out: a screen reader user gets the
            // same warning the colour gives everyone else.
            accessibilityLabel={`${summarise(proposal)} — run this now`}
          >
            <Text style={styles.primaryText}>
              {destructive ? summarise(proposal) : 'Do it'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {state === 'running' && (
        <View style={styles.status}>
          <ActivityIndicator size="small" color={tint} />
          <Text style={styles.statusText}>Running…</Text>
        </View>
      )}

      {(state === 'done' || state === 'failed') && (
        <View style={styles.status}>
          <Icon
            name={state === 'done' ? 'check-circle-outline' : 'alert-circle-outline'}
            size={16}
            color={state === 'done' ? (c.accentSuccess || '#34D399') : (c.accentError || '#F87171')}
          />
          <Text style={styles.statusText} numberOfLines={4}>{outcome}</Text>
        </View>
      )}

      {state === 'dismissed' && (
        <View style={styles.status}>
          <Icon name="close-circle-outline" size={16} color={c.textTertiary} />
          <Text style={styles.statusText}>Left alone.</Text>
        </View>
      )}
    </View>
  );
}

const makeStyles = (theme, tint) => {
  const c = theme.colors;
  return StyleSheet.create({
    card: {
      backgroundColor: c.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: tint,
      padding: 14,
      marginVertical: 6,
      // Definite width rather than a cap — see the same note in ChatBlocks.
      // This card survived shrink-wrapping only because its method/path line
      // and field rows carry real intrinsic width; its own title is
      // `flex: 1, minWidth: 0` and reports zero, so it was one layout change
      // away from the same collapse. Fixing both together also keeps the
      // promise these two files make about being one family: a proposal card
      // and a board in the same transcript now line up instead of each
      // shrinking to its own content.
      width: '92%',
      alignSelf: 'flex-start',
      gap: 8,
    },
    headRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    title: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '700', color: c.textPrimary },
    reason: { fontSize: 12.5, color: c.textSecondary, lineHeight: 18 },

    requestRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    method: {
      fontSize: 10.5, fontWeight: '800', color: tint, letterSpacing: 0.5,
      paddingTop: 1,
    },
    path: { flex: 1, minWidth: 0, fontSize: 11.5, color: c.textTertiary },

    fields: {
      backgroundColor: c.surfaceElevated,
      borderRadius: 9,
      padding: 9,
      gap: 3,
    },
    field: { fontSize: 12, color: c.textSecondary },
    fieldKey: { fontWeight: '700', color: c.textPrimary },
    footnote: { fontSize: 11, color: c.textMuted, marginTop: 2 },

    actions: { flexDirection: 'row', gap: 8, marginTop: 2 },
    secondary: {
      paddingHorizontal: 16, paddingVertical: 9, borderRadius: 9,
      borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
    },
    secondaryText: { fontSize: 13, fontWeight: '600', color: c.textSecondary },
    primary: {
      flex: 1, alignItems: 'center',
      paddingHorizontal: 16, paddingVertical: 9, borderRadius: 9,
      backgroundColor: tint,
    },
    primaryText: { fontSize: 13, fontWeight: '700', color: c.onPrimary || '#000' },

    status: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
    statusText: { flex: 1, minWidth: 0, fontSize: 12.5, color: c.textSecondary, lineHeight: 18 },
  });
};
