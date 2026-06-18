import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../context/ThemeContext';
import { useServer } from '../../../context/ServerContext';

/**
 * ParticipantPicker — pick pond members for a task's "people involved" set
 * (also reused for the calendar default-participants setting). Controlled:
 * `selected` is an array of user IDs, `onChange` gets the next array. Pulls the
 * member list from /api/friends itself. Theme note: mobile has no accentPrimary
 * — uses accentInfo / primary.
 */
export default function ParticipantPicker({ selected = [], onChange }) {
  const { theme } = useTheme();
  const { api } = useServer();
  const [friends, setFriends] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get('/friends')
      .then((r) => { if (!cancelled) setFriends(Array.isArray(r?.friends) ? r.friends : []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [api]);

  const accent = theme.colors.accentInfo || theme.colors.primary || '#0a84ff';
  const nameOf = (id) => {
    const f = friends.find((x) => x.id === id);
    return f ? (f.displayName || f.phone || 'Member') : id;
  };
  const initials = (label) => (label.match(/\b\w/g) || ['?']).slice(0, 2).join('').toUpperCase();
  const toggle = (id) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  const styles = makeStyles(theme, accent);

  return (
    <View>
      {selected.length > 0 && (
        <View style={styles.chips}>
          {selected.map((id) => (
            <View key={id} style={styles.chip}>
              <Text style={styles.chipText} numberOfLines={1}>{nameOf(id)}</Text>
              <TouchableOpacity onPress={() => toggle(id)} hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}>
                <Icon name="close" size={14} color={theme.colors.textTertiary} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      <TouchableOpacity style={styles.addBtn} onPress={() => setOpen(true)} activeOpacity={0.7}>
        <Icon name="account-plus-outline" size={16} color={theme.colors.textSecondary} />
        <Text style={styles.addText}>Add people</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setOpen(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>People involved</Text>
            <ScrollView style={{ maxHeight: 340 }} keyboardShouldPersistTaps="handled">
              {friends.length === 0 ? (
                <Text style={styles.empty}>No other members in your pond yet.</Text>
              ) : (
                friends.map((f) => {
                  const on = selected.includes(f.id);
                  const label = f.displayName || f.phone || 'Member';
                  return (
                    <TouchableOpacity
                      key={f.id}
                      style={[styles.row, on && styles.rowOn]}
                      onPress={() => toggle(f.id)}
                      activeOpacity={0.6}
                    >
                      <View style={styles.avatar}>
                        <Text style={styles.avatarText}>{initials(label)}</Text>
                      </View>
                      <Text style={styles.rowText} numberOfLines={1}>{label}</Text>
                      {on ? <Icon name="check" size={18} color={accent} /> : null}
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
            <TouchableOpacity style={styles.doneBtn} onPress={() => setOpen(false)}>
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
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
    chip: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      paddingVertical: 5, paddingHorizontal: 10, borderRadius: 14,
      backgroundColor: accent + '22', maxWidth: '100%',
    },
    chipText: { fontSize: 13, color: theme.colors.textPrimary, flexShrink: 1 },
    addBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingVertical: 11, paddingHorizontal: 14, borderRadius: 10,
      borderWidth: 1, borderColor: theme.colors.border, borderStyle: 'dashed',
      alignSelf: 'flex-start',
    },
    addText: { fontSize: 14, color: theme.colors.textSecondary, fontWeight: '600' },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 24 },
    sheet: {
      backgroundColor: theme.colors.surface, borderRadius: 16, padding: 16,
      borderWidth: 0.5, borderColor: theme.colors.border,
    },
    sheetTitle: { fontSize: 16, fontWeight: '700', color: theme.colors.textPrimary, marginBottom: 12 },
    empty: { fontSize: 14, color: theme.colors.textTertiary, fontStyle: 'italic', paddingVertical: 12 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 10 },
    rowOn: { backgroundColor: accent + '14' },
    avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: accent + '33', alignItems: 'center', justifyContent: 'center' },
    avatarText: { fontSize: 12, fontWeight: '700', color: accent },
    rowText: { flex: 1, fontSize: 15, color: theme.colors.textPrimary },
    doneBtn: { marginTop: 12, paddingVertical: 12, borderRadius: 10, backgroundColor: accent, alignItems: 'center' },
    doneText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  });
