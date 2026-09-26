/**
 * PeoplePicker — who is on this task: pond members, and guests from your phone.
 *
 * It is a PROFILE LOOKUP, not a checklist in a box. The shape is the one the
 * vault's search already uses (VaultResultRow — Instagram's user search, for
 * the reason given there: while you are hunting for ONE person by name, a
 * column of names you can run your eye down beats anything else), and it fills
 * the screen rather than sitting in the middle of a dimmed form. The box it
 * replaced gave the list ~320 pt with the form greyed out behind it: fine for
 * ticking three names, useless for finding one among thirty.
 *
 * Three ways in:
 *
 *   • SEARCH across the WHOLE pond, by name or by number — you look someone up
 *     by whichever of the two you happen to have.
 *   • OFTEN WITH YOU — the three you put on tasks most, counted from your own
 *     saves (utils/peopleFrequency). Most of the time the person you want is
 *     one of three, and the field is for the rest.
 *   • FROM CONTACTS — someone who is not in the pond at all. They are stored on
 *     the task as a guest with a phone number, and the reminder that goes to
 *     everyone else goes to them as a TEXT. That is the whole point: the
 *     appointment is with them, and they are the one person who currently finds
 *     out about it by being told in person.
 *
 * Controlled on two axes: `selected` is pond user ids, `guests` is
 * [{ name, phone }]. Both come back through their own onChange.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AppTextInput from '../../../components/AppTextInput';
import { useTheme } from '../../../context/ThemeContext';
import { useServer } from '../../../context/ServerContext';
import { tapHaptic } from '../../../utils/haptics';
import { ROW_COVER, VaultResultRow } from '../../TurtleScreen/components/VaultSearchDock';
import { loadCounts, rankPeople } from '../utils/peopleFrequency';

/** Fold case and spacing so "Mo" finds "Mohamed" and " mo " finds it too. */
const norm = (s) => String(s || '').trim().toLowerCase();

/** The label a pond member goes by, in the order they are likely to know it. */
export const memberLabel = (f) => (f?.displayName || f?.phone || 'Member');

/**
 * Members matching a query, by name OR number — you look someone up by
 * whichever of the two you happen to have. The whole pond is searched; nothing
 * is capped or paged, because a personal pond is tens of people and the one you
 * want is as likely to be last as first.
 */
export function matchMembers(friends, query) {
  const q = norm(query);
  if (!q) return friends || [];
  return (friends || []).filter((f) => norm(memberLabel(f)).includes(q) || norm(f?.phone).includes(q));
}

/**
 * A phone number reduced to its digits, with a leading 00 read as a +.
 *
 * Used for EQUALITY only — "(416) 555-0134" and "416-555-0134" are the same
 * person, and a guest list holding both is a guest who gets two texts.
 * Deliberately not a formatter and not a validator: the number is sent as the
 * contact stored it, because they are the ones who know what their number is.
 */
export function phoneKey(phone) {
  const digits = String(phone || '').replace(/[^\d]/g, '');
  return digits.replace(/^00/, '');
}

/** Initials for the avatar disc — two letters at most. */
const initialsOf = (label) => (String(label).match(/\b\w/g) || ['?']).slice(0, 2).join('').toUpperCase();

export default function PeoplePicker({
  selected = [],
  onChange,
  guests = [],
  onGuestsChange,
  // Off for the Settings default, where a phone number texted about every task
  // you will ever make is not a setting anybody means to make.
  allowGuests = true,
}) {
  const { theme } = useTheme();
  const { api } = useServer();
  const insets = useSafeAreaInsets();
  const [friends, setFriends] = useState([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [counts, setCounts] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get('/friends')
      .then((r) => { if (!cancelled) setFriends(Array.isArray(r?.friends) ? r.friends : []); })
      .catch(() => {});
    loadCounts().then((c) => { if (!cancelled) setCounts(c); });
    return () => { cancelled = true; };
  }, [api]);

  const accent = theme.colors.accentInfo || theme.colors.primary || '#0a84ff';
  const styles = useMemo(() => makeStyles(theme, accent), [theme, accent]);

  const byId = useMemo(() => new Map((friends || []).map((f) => [f.id, f])), [friends]);
  const nameOf = (id) => (byId.has(id) ? memberLabel(byId.get(id)) : id);
  const toggle = (id) => {
    tapHaptic();
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  const matches = useMemo(() => matchMembers(friends, query), [friends, query]);
  // Only while browsing: once you are searching, the answer is the search.
  const suggested = useMemo(
    () => (query.trim() ? [] : rankPeople(counts, { limit: 3, exclude: selected }).filter((id) => byId.has(id))),
    [counts, selected, byId, query],
  );

  const removeGuest = (key) => {
    tapHaptic();
    onGuestsChange?.((guests || []).filter((g) => phoneKey(g.phone) !== key));
  };

  /**
   * Pull one person out of the phone's contacts.
   *
   * `presentContactPickerAsync` rather than reading the whole address book: the
   * system picker returns the ONE contact chosen and nothing else, so the app
   * never holds a copy of everyone you know — and on iOS it needs no permission
   * prompt at all, because you did the choosing.
   */
  const addFromContacts = useCallback(async () => {
    setBusy(true);
    try {
      const Contacts = await import('expo-contacts');
      const picked = await Contacts.presentContactPickerAsync();
      if (!picked) return;
      const numbers = Array.isArray(picked.phoneNumbers) ? picked.phoneNumbers : [];
      const phone = numbers[0]?.number;
      const name = picked.name || picked.firstName || phone || 'Guest';
      if (!phone) {
        Alert.alert('No number', `${name} has no phone number saved, so there is nowhere to send the reminder.`);
        return;
      }
      const key = phoneKey(phone);
      if ((guests || []).some((g) => phoneKey(g.phone) === key)) return;
      onGuestsChange?.([...(guests || []), { name, phone }]);
      tapHaptic();
    } catch (e) {
      Alert.alert('Contacts unavailable', e?.message || 'Could not open your contacts.');
    } finally {
      setBusy(false);
    }
  }, [guests, onGuestsChange]);

  /**
   * One person, in the vault search's own row. Shared rather than restyled, so
   * the two lookups in the app cannot drift apart.
   *
   * The only thing changed about it is the leading slot: a board's covers are
   * rectangles and stay square, and a PERSON is round, the way faces are round
   * everywhere else here.
   */
  const rowFor = (f) => {
    if (!f) return null;
    const on = selected.includes(f.id);
    const label = memberLabel(f);
    // The number is the second line only where there is a NAME above it — two
    // people called Michelle are told apart by it, which is the same thing you
    // would check on a profile. Where the number IS the name, repeating it
    // under itself says nothing.
    const meta = f.displayName && f.phone ? f.phone : null;
    return (
      <VaultResultRow
        key={f.id}
        theme={theme}
        name={label}
        meta={meta}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: on }}
        accessibilityLabel={label}
        onPress={() => toggle(f.id)}
        testID={`people-row-${f.id}`}
        leadingStyle={styles.avatar}
        leading={<Text style={styles.avatarText}>{initialsOf(label)}</Text>}
        trailing={on ? <Icon name="check-circle" size={22} color={accent} /> : null}
      />
    );
  };

  return (
    <View>
      {(selected.length > 0 || (guests || []).length > 0) && (
        <View style={styles.chips}>
          {selected.map((id) => (
            <View key={id} style={styles.chip}>
              <Text style={styles.chipText} numberOfLines={1}>{nameOf(id)}</Text>
              <TouchableOpacity onPress={() => toggle(id)} hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}>
                <Icon name="close" size={14} color={theme.colors.textTertiary} />
              </TouchableOpacity>
            </View>
          ))}
          {/* A guest wears the message glyph, because that is the difference
              that matters: everyone else gets a notification in the app, and
              this one gets a text. */}
          {(guests || []).map((g) => (
            <View key={phoneKey(g.phone)} style={[styles.chip, styles.chipGuest]} testID={`people-guest-${phoneKey(g.phone)}`}>
              <Icon name="message-text-outline" size={12} color={theme.colors.textSecondary} />
              <Text style={styles.chipText} numberOfLines={1}>{g.name}</Text>
              <TouchableOpacity onPress={() => removeGuest(phoneKey(g.phone))} hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}>
                <Icon name="close" size={14} color={theme.colors.textTertiary} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      <TouchableOpacity style={styles.addBtn} onPress={() => { tapHaptic(); setOpen(true); }} activeOpacity={0.7} testID="people-open">
        <Icon name="account-plus-outline" size={16} color={theme.colors.textSecondary} />
        <Text style={styles.addText}>Add people</Text>
      </TouchableOpacity>

      {/* A page, not a box. Looking someone up is a whole-screen job. */}
      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <View style={[styles.panel, { paddingTop: insets.top + 12 }]}>
          <View style={styles.head}>
            <Text style={styles.title}>People involved</Text>
            <TouchableOpacity
              onPress={() => { setQuery(''); setOpen(false); }}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              testID="people-done"
            >
              <Text style={styles.done}>Done</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.search}>
            <Icon name="magnify" size={19} color={theme.colors.textMuted} />
            <AppTextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search your pond"
              placeholderTextColor={theme.colors.textMuted}
              placeholderTestID="people-search-placeholder"
              accessibilityLabel="Search your pond"
              autoCorrect={false}
              autoCapitalize="none"
              spellCheck={false}
              clearButtonMode="never"
              style={styles.searchInput}
              testID="people-search"
            />
            {query ? (
              <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Icon name="close-circle" size={19} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            ) : null}
          </View>

          <ScrollView
            style={styles.list}
            contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 12) + 12 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            {suggested.length > 0 && (
              <>
                <Text style={styles.group}>OFTEN WITH YOU</Text>
                {suggested.map((id) => rowFor(byId.get(id)))}
                <Text style={styles.group}>EVERYONE</Text>
              </>
            )}
            {matches.length === 0 ? (
              <Text style={styles.empty}>
                {query.trim()
                  ? `Nobody in your pond matches “${query.trim()}”.`
                  : 'No other members in your pond yet.'}
              </Text>
            ) : matches.map(rowFor)}

            {allowGuests && (
              /* The way OUT of the pond, at the foot of the list where you
                 arrive having not found them — it is a different kind of
                 answer, not "which of these" but "none of these". */
              <TouchableOpacity style={styles.contacts} onPress={addFromContacts} disabled={busy} testID="people-contacts">
                {busy
                  ? <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                  : <Icon name="card-account-phone-outline" size={20} color={accent} />}
                <View style={{ flex: 1 }}>
                  <Text style={styles.contactsText}>Add from contacts</Text>
                  <Text style={styles.contactsHint}>They get the reminder as a text message</Text>
                </View>
                <Icon name="chevron-right" size={20} color={theme.colors.textTertiary} />
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
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
    // A guest is not a pond member and does not pretend to be one.
    chipGuest: { backgroundColor: theme.colors.surfaceElevated, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border },
    chipText: { fontSize: 13, color: theme.colors.textPrimary, flexShrink: 1 },
    addBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingVertical: 11, paddingHorizontal: 14, borderRadius: 10,
      borderWidth: 1, borderColor: theme.colors.border, borderStyle: 'dashed',
      alignSelf: 'flex-start',
    },
    addText: { fontSize: 14, color: theme.colors.textSecondary, fontWeight: '600' },
    panel: { flex: 1, backgroundColor: theme.colors.background, paddingHorizontal: 16 },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
    title: { fontSize: 22, fontWeight: '700', color: theme.colors.textPrimary },
    done: { fontSize: 16, fontWeight: '700', color: accent },
    // The vault's own pill, at the vault's own proportions.
    search: {
      flexDirection: 'row', alignItems: 'center', gap: 8, height: 38,
      borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      borderRadius: 19, paddingHorizontal: 14, marginBottom: 6,
    },
    searchInput: { flex: 1, fontSize: 15, height: '100%', padding: 0, color: theme.colors.textPrimary },
    list: { flex: 1 },
    group: {
      fontSize: 10.5, letterSpacing: 0.9, fontWeight: '700',
      color: theme.colors.textTertiary, marginTop: 14, marginBottom: 2, paddingHorizontal: 2,
    },
    empty: { fontSize: 14, color: theme.colors.textTertiary, fontStyle: 'italic', paddingVertical: 20, paddingHorizontal: 2 },
    // The vault row's square, made ROUND: a face is round here.
    avatar: { borderRadius: ROW_COVER / 2, backgroundColor: accent + '33' },
    avatarText: { fontSize: 16, fontWeight: '700', color: accent },
    contacts: {
      flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16,
      paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    contactsText: { fontSize: 15, fontWeight: '600', color: theme.colors.textPrimary },
    contactsHint: { fontSize: 12, color: theme.colors.textTertiary, marginTop: 1 },
  });
