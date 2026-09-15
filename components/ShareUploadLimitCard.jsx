/**
 * Settings → Shared links → how big a file a visitor may drop.
 *
 * A public share link with uploads on is a drop box for people who have no
 * account here — the "drive" side of the pond. Until now the ceiling on that
 * was `SHARE_UPLOAD_MAX_BYTES`, an env var on the box: changing it meant
 * editing a service definition and restarting. It is the owner's call, so it
 * belongs where the owner is.
 *
 * Presets rather than a bare number field, because the answer is always one of
 * a handful of sizes and typing "4096" is a worse way to say 4 GB. The custom
 * field is still there for the case none of them fit.
 *
 * `Unlimited` is a real option and is stored as 0. When the machine carries
 * its own cap the card SAYS so rather than silently clamping — saving
 * "unlimited" onto a capped box would otherwise look like it hadn't worked.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { useServer } from '../context/ServerContext';
import { useTheme } from '../context/ThemeContext';
import { tapHaptic, notifyHaptic } from '../utils/haptics';

/** 0 is unlimited — the same convention the server stores. */
const PRESETS = [
  { mb: 256, label: '256 MB' },
  { mb: 512, label: '512 MB' },
  { mb: 2048, label: '2 GB' },
  { mb: 10240, label: '10 GB' },
  { mb: 0, label: 'Unlimited' },
];

/** "2 GB" / "512 MB" / "Unlimited" — whole units only, no trailing .0. */
export function formatLimitMb(mb) {
  if (mb === 0) return 'Unlimited';
  if (!Number.isFinite(mb) || mb < 0) return '—';
  if (mb >= 1024 && mb % 1024 === 0) return `${mb / 1024} GB`;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

/**
 * What to say under the presets. Three states, and the third is the one worth
 * getting right: the owner asked for more than the machine allows, and needs
 * to know the machine won.
 */
export function ceilingNotice({ chosenMb, effectiveMb, hardCapMb }) {
  if (hardCapMb == null) return null;
  if (chosenMb !== 0 && chosenMb <= hardCapMb) return null;
  return `This server is capped at ${formatLimitMb(hardCapMb)} by SHARE_UPLOAD_MAX_BYTES, so visitors get ${formatLimitMb(effectiveMb)}.`;
}

export default function ShareUploadLimitCard({ styles: parentStyles }) {
  const { theme } = useTheme();
  const { api } = useServer();
  const [state, setState] = useState(null);   // { chosen, effective, hardCap }
  const [saving, setSaving] = useState(false);
  const [custom, setCustom] = useState('');
  const s = createStyles(theme);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/settings');
      const cfg = res?.settings || {};
      setState({
        chosen: Number(cfg.share_upload_max_mb ?? 512),
        effective: Number(cfg.share_upload_effective_mb ?? cfg.share_upload_max_mb ?? 512),
        hardCap: cfg.share_upload_hard_cap_mb ?? null,
      });
    } catch {
      setState({ chosen: 512, effective: 512, hardCap: null, offline: true });
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (mb) => {
    if (saving) return;
    setSaving(true);
    const previous = state;
    setState((prev) => (prev ? { ...prev, chosen: mb } : prev));   // optimistic
    try {
      const res = await api.patch('/settings', { share_upload_max_mb: mb });
      const cfg = res?.settings || {};
      setState({
        chosen: Number(cfg.share_upload_max_mb ?? mb),
        effective: Number(cfg.share_upload_effective_mb ?? mb),
        hardCap: cfg.share_upload_hard_cap_mb ?? null,
      });
      setCustom('');
      notifyHaptic('success');
    } catch (e) {
      setState(previous);                                          // rollback
      Alert.alert('Not saved', e?.message || 'Could not change the upload limit.');
    } finally {
      setSaving(false);
    }
  }, [api, saving, state]);

  const saveCustom = useCallback(() => {
    const mb = Number(String(custom).trim());
    if (!Number.isFinite(mb) || mb < 0 || Math.floor(mb) !== mb) {
      Alert.alert('Not a size', 'Enter a whole number of megabytes, or 0 for unlimited.');
      return;
    }
    save(mb);
  }, [custom, save]);

  if (!state) {
    return (
      <View style={s.loading}>
        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
      </View>
    );
  }

  const notice = ceilingNotice({
    chosenMb: state.chosen, effectiveMb: state.effective, hardCap: state.hardCap, hardCapMb: state.hardCap,
  });

  return (
    <View testID="share-upload-limit-card">
      <Text style={parentStyles?.hint ?? s.hint}>
        The biggest single file someone can drop into a share link that has uploads turned on.
        Each link can still set a smaller limit of its own.
      </Text>

      <View style={s.row}>
        {PRESETS.map(({ mb, label }) => {
          const active = state.chosen === mb;
          return (
            <Pressable
              key={mb}
              testID={`share-upload-preset-${mb}`}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Visitor upload limit ${label}`}
              disabled={saving}
              onPressIn={() => tapHaptic()}
              onPress={() => save(mb)}
              style={({ pressed }) => [
                s.chip,
                { backgroundColor: active ? theme.colors.primary : theme.colors.surfaceElevated },
                pressed && { opacity: 0.6 },
              ]}
            >
              <Text style={[s.chipText, { color: active ? theme.colors.background : theme.colors.textSecondary }]}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={s.customRow}>
        <TextInput
          testID="share-upload-custom"
          value={custom}
          onChangeText={setCustom}
          keyboardType="number-pad"
          placeholder="Custom MB"
          placeholderTextColor={theme.colors.textMuted}
          accessibilityLabel="Custom upload limit in megabytes"
          style={[s.input, { color: theme.colors.textPrimary, borderColor: theme.colors.border }]}
          onSubmitEditing={saveCustom}
          returnKeyType="done"
        />
        <Pressable
          testID="share-upload-custom-apply"
          accessibilityRole="button"
          accessibilityLabel="Apply custom upload limit"
          disabled={saving || !custom.trim()}
          onPress={saveCustom}
          style={({ pressed }) => [
            s.apply,
            { backgroundColor: theme.colors.surfaceElevated },
            (saving || !custom.trim()) && { opacity: 0.4 },
            pressed && { opacity: 0.6 },
          ]}
        >
          <Icon name="check" size={18} color={theme.colors.textPrimary} />
        </Pressable>
      </View>

      <View style={s.statusRow}>
        <Icon
          name={state.effective === 0 ? 'infinity' : 'cloud-upload-outline'}
          size={15}
          color={theme.colors.textSecondary}
        />
        <Text style={s.status}>
          Visitors can upload files up to {formatLimitMb(state.effective)}
        </Text>
        {saving && <ActivityIndicator size="small" color={theme.colors.textSecondary} />}
      </View>

      {!!notice && <Text style={[s.status, s.notice]}>{notice}</Text>}
    </View>
  );
}

const createStyles = (theme) => StyleSheet.create({
  loading: { paddingVertical: 20, alignItems: 'center' },
  hint: { fontSize: 13, color: theme.colors.textSecondary, lineHeight: 19, marginBottom: 12 },
  // wrap: five chips never fit one row on a 375pt screen.
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 36, borderRadius: 18, paddingHorizontal: 14, justifyContent: 'center', flexShrink: 1, maxWidth: '100%' },
  chipText: { fontSize: 14, fontWeight: '600' },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  input: { flex: 1, height: 40, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 12, fontSize: 15 },
  apply: { width: 44, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  status: { fontSize: 13, color: theme.colors.textSecondary, flexShrink: 1 },
  notice: { marginTop: 6, fontStyle: 'italic' },
});
