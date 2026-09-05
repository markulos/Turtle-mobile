/**
 * SmsDebugPanel — why a text did or didn't go out, and a way to prove it.
 *
 * Built after a login SMS failed for five days while every screen said "Could
 * not send the SMS. Please try again." The cause was one Telnyx switch
 * (`mobile_only` on the messaging profile) rejecting a number Telnyx's OWN
 * carrier lookup called mobile in the same minute — the gate leans on line-type
 * data that had come back empty. Their portal no longer draws that switch, so
 * the only way to see it is to ask the provider's API, and nothing in this app
 * could ask.
 *
 * ─── Why it is shaped the way it is ─────────────────────────────────────────
 *
 * The two columns are the whole idea. "This pond" is what we are configured to
 * do; "Provider" is what the other side believes right now. Those two
 * disagreed for five days, and a single merged status line would have hidden
 * exactly the disagreement that mattered. They are separate so they can differ
 * visibly.
 *
 * Warnings arrive pre-computed from the server rather than being re-derived
 * here, so the phone and the web panel can never reach different conclusions
 * from the same facts.
 *
 * A failed send shows the provider's RAW verdict — status, code, title, detail.
 * The polite sanitized sentence is what caused the five days; it is still shown,
 * but as the thing users would have seen, not as the explanation.
 *
 * Collapsed by default: nothing is fetched until it is opened, and opening it
 * costs one provider round-trip, not a poll.
 *
 * Owner-only. A 403 removes the panel outright (a pond member is not missing a
 * feature — this simply isn't theirs), and a 404 does too, because a phone
 * updates from the App Store while a pond updates when someone deploys it, and
 * the two are never in step.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';
import { useServer } from '../context/ServerContext';
import { tapHaptic } from '../utils/haptics';

const DEFAULT_TEMPLATE = '🐢 Turtle test message — if you can read this, SMS from your pond works.';
const MAX_TEXT = 480;

export default function SmsDebugPanel() {
  const { theme } = useTheme();
  const { api, isConnected } = useServer();
  const c = theme.colors;

  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState(null);
  const [status, setStatus] = useState(null); // 'forbidden' | 'absent' | 'error' | null
  const [loading, setLoading] = useState(false);

  const [to, setTo] = useState('');
  const [text, setText] = useState(DEFAULT_TEMPLATE);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/sms-debug/config');
      if (r?.success) { setCfg(r); setStatus(null); }
      else setStatus('error');
    } catch (e) {
      const message = String(e?.message);
      if (/403|forbidden|owner/i.test(message)) setStatus('forbidden');
      else if (/404|not found/i.test(message)) setStatus('absent');
      else setStatus('error');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { if (open && !cfg && isConnected) load(); }, [open, cfg, isConnected, load]);

  const send = useCallback(async () => {
    setSending(true);
    setResult(null);
    try {
      const r = await api.post('/sms-debug/send', { to: to.trim(), text });
      setResult(r);
    } catch (e) {
      // The API helper throws on non-2xx, so the useful body arrives as the
      // message. Show it verbatim — a swallowed failure is the whole problem.
      setResult({ success: false, message: String(e?.message || 'Request failed') });
    } finally {
      setSending(false);
      load(); // balance and profile settings may have moved
    }
  }, [api, to, text, load]);

  if (status === 'forbidden' || status === 'absent') return null;

  const styles = makeStyles(theme);
  const tint = c.accentInfo;
  const local = cfg?.local;
  const prov = cfg?.provider;
  const activeProfile = prov?.profiles?.find((p) => p.id === prov?.fromNumber?.messagingProfileId)
    || (prov?.profiles?.length === 1 ? prov.profiles[0] : undefined);
  const levelColor = (l) => (l === 'error' ? c.accentError : l === 'warn' ? c.accentWarning : c.textSecondary);
  const canSend = !!to.trim() && !!text.trim() && text.length <= MAX_TEXT && !sending;

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={styles.header}
        onPress={() => { tapHaptic(); setOpen((v) => !v); }}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="SMS debugger"
      >
        <Icon name="message-alert-outline" size={18} color={tint} />
        <Text style={styles.title}>SMS debugger</Text>
        <View style={{ flex: 1 }} />
        {loading ? <ActivityIndicator size="small" color={tint} /> : null}
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={20} color={c.textSecondary} />
      </TouchableOpacity>

      {open ? (
        <View style={styles.body}>
          {status === 'error' ? (
            <TouchableOpacity onPress={() => { tapHaptic(); load(); }} style={styles.retry}>
              <Text style={styles.retryText}>Couldn't read SMS settings — tap to retry</Text>
            </TouchableOpacity>
          ) : null}

          {/* What we believe, beside what the provider believes. */}
          <View style={styles.cols}>
            <View style={styles.col}>
              <Text style={styles.colLabel}>THIS POND</Text>
              <Text style={styles.mono}>from {local?.fromNumber || '—'}</Text>
              <Text style={styles.mono}>
                key {local?.apiKey?.present
                  ? (local.apiKey.wellFormed ? 'ok' : `MALFORMED (${local.apiKey.length})`)
                  : 'missing'}
              </Text>
              <Text style={styles.mono}>dev mode {local?.devMode ? 'ON' : 'off'}</Text>
            </View>
            <View style={styles.col}>
              <Text style={styles.colLabel}>PROVIDER</Text>
              {prov?.ok ? (
                <>
                  <Text style={styles.mono} numberOfLines={1}>profile {activeProfile?.name || '—'}</Text>
                  <Text style={styles.mono}>mobile-only {activeProfile ? (activeProfile.mobileOnly ? 'ON' : 'off') : '—'}</Text>
                  <Text style={styles.mono}>
                    balance {prov.balance ? `${prov.balance.balance} ${prov.balance.currency}` : '—'}
                  </Text>
                  <Text style={styles.mono}>number {prov.fromNumber?.status || '—'}</Text>
                </>
              ) : (
                <Text style={[styles.mono, { color: c.accentWarning }]}>
                  unreachable{prov?.error ? `: ${prov.error}` : ''}
                </Text>
              )}
            </View>
          </View>

          {cfg?.warnings?.length ? (
            <View style={styles.warnings}>
              {cfg.warnings.map((w, i) => (
                <View key={i} style={styles.warnRow}>
                  <Icon
                    name={w.level === 'info' ? 'information-outline' : 'alert-outline'}
                    size={13}
                    color={levelColor(w.level)}
                    style={{ marginTop: 2 }}
                  />
                  <Text style={[styles.warnText, { color: levelColor(w.level) }]}>{w.text}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* A real send to a real handset — the only end-to-end proof. */}
          <View style={styles.sendBlock}>
            <Text style={styles.colLabel}>SEND A REAL TEST TO</Text>
            <TextInput
              style={styles.input}
              value={to}
              onChangeText={setTo}
              placeholder="+1…"
              placeholderTextColor={c.textTertiary || c.textSecondary}
              keyboardType="phone-pad"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={[styles.colLabel, { marginTop: 10 }]}>MESSAGE ({text.length}/{MAX_TEXT})</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              value={text}
              onChangeText={setText}
              multiline
              textAlignVertical="top"
            />
            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.sendBtn, { backgroundColor: tint, opacity: canSend ? 1 : 0.5 }]}
                onPress={() => { tapHaptic(); send(); }}
                disabled={!canSend}
                accessibilityRole="button"
                accessibilityLabel="Send test message"
              >
                {sending
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Icon name="send" size={14} color="#fff" />}
                <Text style={styles.sendBtnText}>{sending ? 'Sending…' : 'Send test'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.resetBtn}
                onPress={() => { tapHaptic(); setText(DEFAULT_TEMPLATE); }}
                accessibilityRole="button"
                accessibilityLabel="Reset message text"
              >
                <Text style={styles.resetText}>Reset text</Text>
              </TouchableOpacity>
              <Text style={styles.quota}>10/hr</Text>
            </View>

            {result ? (
              <View style={[
                styles.result,
                { borderColor: result.success ? c.border : c.accentError },
              ]}>
                <View style={styles.resultHead}>
                  <Icon
                    name={result.success ? 'check-circle-outline' : 'alert-circle-outline'}
                    size={14}
                    color={result.success ? c.accentSuccess : c.accentError}
                  />
                  <Text style={[styles.resultTitle, { color: result.success ? c.accentSuccess : c.accentError }]}>
                    {result.success ? 'Accepted' : 'Failed'}
                  </Text>
                  {result.to ? <Text style={styles.resultMeta}>· {result.to}</Text> : null}
                  {result.elapsedMs != null ? <Text style={styles.resultMeta}>· {result.elapsedMs}ms</Text> : null}
                </View>
                {result.message ? <Text style={styles.resultBody}>{result.message}</Text> : null}
                {result.provider?.code ? (
                  <Text style={styles.mono}>
                    {result.provider.httpStatus} · {result.provider.code} · {result.provider.title}
                    {result.provider.detail ? ` — ${result.provider.detail}` : ''}
                  </Text>
                ) : null}
                {result.actionable ? (
                  <Text style={[styles.warnText, { color: c.accentWarning, marginTop: 6, marginLeft: 0 }]}>
                    {result.actionable}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (theme) => {
  const c = theme.colors;
  return StyleSheet.create({
    wrap: {
      backgroundColor: c.surface,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      marginBottom: 12,
      overflow: 'hidden',
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
    title: { fontSize: 15, fontWeight: '600', color: c.textPrimary },
    body: { paddingHorizontal: 14, paddingBottom: 14, gap: 12 },
    cols: { flexDirection: 'row', gap: 14 },
    col: { flex: 1, gap: 2 },
    colLabel: { fontSize: 10, letterSpacing: 0.5, color: c.textSecondary, marginBottom: 4 },
    mono: { fontSize: 12, color: c.textPrimary, fontVariant: ['tabular-nums'] },
    warnings: { gap: 6 },
    warnRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
    warnText: { flex: 1, fontSize: 12, lineHeight: 17 },
    sendBlock: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, paddingTop: 12 },
    // Explicit height + zero vertical padding + centered text: the house rule
    // for inline inputs, since padding makes the glyphs ride high.
    input: {
      backgroundColor: c.inputBackground || c.surfaceElevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 0,
      height: 40,
      textAlignVertical: 'center',
      color: c.textPrimary,
      fontSize: 14,
    },
    multiline: { height: 76, paddingVertical: 8, textAlignVertical: 'top' },
    actions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
    sendBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      paddingHorizontal: 14, height: 36, borderRadius: 8,
    },
    sendBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
    resetBtn: {
      paddingHorizontal: 12, height: 36, justifyContent: 'center',
      borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
    },
    resetText: { color: c.textSecondary, fontSize: 12 },
    quota: { color: c.textSecondary, fontSize: 11 },
    result: {
      marginTop: 12, padding: 10, borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      backgroundColor: c.inputBackground || c.surfaceElevated,
      gap: 2,
    },
    resultHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
    resultTitle: { fontSize: 13, fontWeight: '700' },
    resultMeta: { fontSize: 12, color: c.textSecondary },
    resultBody: { fontSize: 12, color: c.textPrimary, marginBottom: 2 },
    retry: { paddingVertical: 8 },
    retryText: { color: c.accentWarning, fontSize: 12 },
  });
};
