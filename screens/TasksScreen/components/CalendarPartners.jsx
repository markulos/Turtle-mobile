import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../context/ThemeContext';
import { useServer } from '../../../context/ServerContext';

/**
 * CalendarPartners — manage "partner accounts" (whole-calendar shares) from the
 * Calendar settings tab. Backed entirely by the existing /api/shares 'all-tasks'
 * share type (server.js): a partner share is one-way + view-only.
 *   • partnersIn  = people whose ENTIRE calendar shows up on MINE (they shared
 *                   with me). These tasks already flow into the task feed via
 *                   taskVisibility and render with owner badges (multiUser).
 *   • partnersOut = people who can see MY calendar (I shared out).
 * To get a two-way couple view, BOTH people add each other. Removing a share
 * stops the calendars from showing (either party may remove it).
 *
 * Theme note: mobile has no accentPrimary — use accentInfo / primary.
 */
export default function CalendarPartners() {
  const { theme } = useTheme();
  const { api, isConnected } = useServer();
  const [friends, setFriends] = useState([]);
  const [partnersOut, setPartnersOut] = useState([]);
  const [partnersIn, setPartnersIn] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const load = useCallback(() => {
    if (!isConnected) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.get('/shares').catch(() => null),
      api.get('/friends').catch(() => null),
    ])
      .then(([shares, fr]) => {
        if (cancelled) return;
        setPartnersOut(Array.isArray(shares?.partnersOut) ? shares.partnersOut : []);
        setPartnersIn(Array.isArray(shares?.partnersIn) ? shares.partnersIn : []);
        setFriends(Array.isArray(fr?.friends) ? fr.friends : []);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api, isConnected]);

  useEffect(() => { load(); }, [load]);

  const addPartner = async (userId) => {
    setBusy(true);
    setPickerOpen(false);
    try {
      await api.post('/shares', { itemType: 'all-tasks', withUserId: userId });
    } catch (e) {
      // ignore — load() below reconciles to the server's truth
    } finally {
      setBusy(false);
      load();
    }
  };

  const removeShare = async (id) => {
    // Optimistic: drop it from whichever list it's in, reconcile on failure.
    setPartnersOut((p) => p.filter((x) => x.id !== id));
    setPartnersIn((p) => p.filter((x) => x.id !== id));
    try {
      await api.delete(`/shares/${id}`);
    } catch (e) {
      load();
    }
  };

  const accent = theme.colors.accentInfo || theme.colors.primary || '#0a84ff';
  const styles = makeStyles(theme, accent);
  const initials = (label) => ((label || '?').match(/\b\w/g) || ['?']).slice(0, 2).join('').toUpperCase();

  // Pond members I'm not already sharing my calendar with (and not myself).
  const outIds = new Set(partnersOut.map((p) => p.withUserId));
  const candidates = friends.filter((f) => !outIds.has(f.id));

  return (
    <View style={styles.wrap}>
      {/* Whose calendars appear on mine */}
      <Text style={styles.groupLabel}>On my calendar</Text>
      {partnersIn.length === 0 ? (
        <Text style={styles.hint}>No one shares their calendar with you yet. When someone adds you as a partner, their tasks appear here and on your calendar.</Text>
      ) : (
        partnersIn.map((p) => (
          <View key={p.id} style={styles.row}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{initials(p.fromName)}</Text></View>
            <Text style={styles.rowText} numberOfLines={1}>{p.fromName}</Text>
            <TouchableOpacity onPress={() => removeShare(p.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.removeText}>Hide</Text>
            </TouchableOpacity>
          </View>
        ))
      )}

      {/* Whose calendars I share out */}
      <Text style={[styles.groupLabel, { marginTop: 14 }]}>Sharing my calendar with</Text>
      {partnersOut.length === 0 ? (
        <Text style={styles.hint}>No one. Add a partner to let them see your whole calendar (view-only).</Text>
      ) : (
        partnersOut.map((p) => (
          <View key={p.id} style={styles.row}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{initials(p.withName)}</Text></View>
            <Text style={styles.rowText} numberOfLines={1}>{p.withName}</Text>
            <TouchableOpacity onPress={() => removeShare(p.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.removeText}>Stop</Text>
            </TouchableOpacity>
          </View>
        ))
      )}

      <TouchableOpacity style={styles.addBtn} onPress={() => setPickerOpen(true)} activeOpacity={0.7} disabled={busy}>
        {busy ? (
          <ActivityIndicator size="small" color={theme.colors.textSecondary} />
        ) : (
          <Icon name="account-heart-outline" size={16} color={theme.colors.textSecondary} />
        )}
        <Text style={styles.addText}>Add a partner</Text>
      </TouchableOpacity>
      {loading && <Text style={styles.loading}>Loading partners…</Text>}

      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setPickerOpen(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Share my calendar with</Text>
            <Text style={styles.sheetSub}>They&rsquo;ll see your whole calendar (view-only). For a two-way view, they add you back.</Text>
            <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
              {candidates.length === 0 ? (
                <Text style={styles.empty}>{friends.length === 0 ? 'No other members in your pond yet.' : 'Everyone is already a partner.'}</Text>
              ) : (
                candidates.map((f) => {
                  const label = f.displayName || f.phone || 'Member';
                  return (
                    <TouchableOpacity key={f.id} style={styles.pickRow} onPress={() => addPartner(f.id)} activeOpacity={0.6}>
                      <View style={styles.avatar}><Text style={styles.avatarText}>{initials(label)}</Text></View>
                      <Text style={styles.rowText} numberOfLines={1}>{label}</Text>
                      <Icon name="plus" size={18} color={accent} />
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
            <TouchableOpacity style={styles.doneBtn} onPress={() => setPickerOpen(false)}>
              <Text style={styles.doneText}>Done</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const makeStyles = (theme, accent) =>
  StyleSheet.create({
    wrap: { marginTop: 2 },
    groupLabel: {
      fontSize: 11, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase',
      color: theme.colors.textTertiary, marginBottom: 6,
    },
    hint: { fontSize: 12, color: theme.colors.textTertiary, lineHeight: 17, marginBottom: 2 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
    pickRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 10 },
    avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: accent + '33', alignItems: 'center', justifyContent: 'center' },
    avatarText: { fontSize: 12, fontWeight: '700', color: accent },
    rowText: { flex: 1, fontSize: 15, color: theme.colors.textPrimary },
    removeText: { fontSize: 13, fontWeight: '600', color: theme.colors.textTertiary },
    addBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingVertical: 11, paddingHorizontal: 14, borderRadius: 10, marginTop: 12,
      borderWidth: 1, borderColor: theme.colors.border, borderStyle: 'dashed', alignSelf: 'flex-start',
    },
    addText: { fontSize: 14, color: theme.colors.textSecondary, fontWeight: '600' },
    loading: { fontSize: 12, color: theme.colors.textTertiary, marginTop: 8 },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 24 },
    sheet: { backgroundColor: theme.colors.surface, borderRadius: 16, padding: 16, borderWidth: 0.5, borderColor: theme.colors.border },
    sheetTitle: { fontSize: 16, fontWeight: '700', color: theme.colors.textPrimary, marginBottom: 4 },
    sheetSub: { fontSize: 12, color: theme.colors.textTertiary, lineHeight: 17, marginBottom: 10 },
    empty: { fontSize: 14, color: theme.colors.textTertiary, fontStyle: 'italic', paddingVertical: 12 },
    doneBtn: { marginTop: 12, paddingVertical: 12, borderRadius: 10, backgroundColor: accent, alignItems: 'center' },
    doneText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  });
