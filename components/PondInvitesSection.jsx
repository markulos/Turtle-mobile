/**
 * PondInvitesSection — the pond owner's invite desk, in Settings → General.
 *
 * The phone-number invite is the whole mechanism, not a convenience: the server
 * runs invite-only, so a number that is not on `invited_phones` cannot even
 * REQUEST a sign-in code. Adding someone here is what makes their phone number
 * recognised — they enter it on the login screen and are already expected.
 *
 * Endpoints (all owner-only server-side):
 *   GET    /auth/invites            → org, members, invited phones, links
 *   POST   /auth/invites {phone}    → allow-list + text them a tap-to-join link
 *   DELETE /auth/invites/:phone     → take the number back off the list
 *   POST   /auth/invite-links       → a code that admits ANY number once used
 *
 * Ownership is established by simply calling the GET: it is requireOwner, so a
 * 200 means owner and a 403 means this whole card should not exist. That avoids
 * inventing a second notion of "am I the owner" on the client that could
 * disagree with the server's.
 *
 * Mirrors the web app's OrgPanel. TurtleScreen has its own "invite a friend"
 * quick action against the same endpoints; this is the admin view — who is on
 * the list, and taking them back off.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Share,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';
import { useServer } from '../context/ServerContext';
import { tapHaptic, impactHaptic, notifyHaptic } from '../utils/haptics';

/**
 * Reduce a typed or pasted number to what the server stores: digits, with at
 * most one leading '+'. Contact apps hand back "(415) 555-0100" and people type
 * "415-555-0100"; both have to land on the same row as the number the invitee
 * signs in with, or the allow-list check silently misses.
 */
function normalizePhone(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const plus = s.startsWith('+') ? '+' : '';
  return plus + s.replace(/\D/g, '');
}

/** Digits only, ignoring the '+', for the "is this long enough" check. */
function digitCount(raw) {
  return String(raw || '').replace(/\D/g, '').length;
}

/**
 * Copy to the clipboard, falling back to the OS share sheet.
 *
 * expo-clipboard is a NATIVE module, so it only exists in a dev build compiled
 * after the dependency was added. Requiring it lazily lets an older binary
 * degrade to sharing instead of crashing on import.
 */
async function copyOrShare(text) {
  let clip = null;
  try { clip = require('expo-clipboard'); } catch { /* not in this build */ }
  if (clip?.setStringAsync) {
    try {
      await clip.setStringAsync(text);
      return 'copied';
    } catch { /* present but failed — fall through */ }
  }
  try {
    await Share.share({ message: text });
    return 'shared';
  } catch {
    return 'none';
  }
}

export default function PondInvitesSection({ active = true }) {
  const { theme } = useTheme();
  const { api } = useServer();
  const styles = createStyles(theme);

  const [loaded, setLoaded] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [org, setOrg] = useState(null);
  const [invites, setInvites] = useState([]);
  const [members, setMembers] = useState([]);
  const [links, setLinks] = useState([]);

  const [phone, setPhone] = useState('+1 ');
  const [busy, setBusy] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);
  const [note, setNote] = useState(null);        // { type: 'ok' | 'err', text }
  const [result, setResult] = useState(null);    // { phone, joinUrl }
  const [copied, setCopied] = useState(null);    // the value most recently copied

  const load = useCallback(async () => {
    try {
      const r = await api.get('/auth/invites');
      setOrg(r?.org || null);
      setInvites(Array.isArray(r?.invites) ? r.invites : []);
      setMembers(Array.isArray(r?.members) ? r.members : []);
      setLinks(Array.isArray(r?.links) ? r.links : []);
      setForbidden(false);
    } catch (e) {
      // requireOwner answers 403; the api client folds the status into the
      // message. Anything else is a transient failure, not "not the owner" —
      // treating it as forbidden would hide the card whenever the pond blips.
      if (/\b403\b/.test(e?.message || '')) setForbidden(true);
    } finally {
      setLoaded(true);
    }
  }, [api]);

  useEffect(() => { if (active) load(); }, [active, load]);

  const invite = useCallback(async () => {
    const normalized = normalizePhone(phone);
    if (digitCount(normalized) < 7) {
      setNote({ type: 'err', text: 'Enter a full phone number, including the country code.' });
      notifyHaptic('warning');
      return;
    }
    setBusy(true);
    setNote(null);
    setResult(null);
    try {
      const r = await api.post('/auth/invites', { phone: normalized });
      setPhone('+1 ');
      // Show them on the list straight away, then let the reload reconcile.
      setInvites((prev) => (
        prev.some((i) => i.phone === normalized)
          ? prev
          : [{ phone: normalized, created_at: Date.now() }, ...prev]
      ));
      setNote({
        type: 'ok',
        text: r?.smsSent
          ? `Invited ${normalized} — they got a tap-to-join text.`
          : `Invited ${normalized}. The text didn’t go through, so send them the link yourself.`,
      });
      if (r?.joinUrl) setResult({ phone: normalized, joinUrl: r.joinUrl });
      load();
    } catch (e) {
      const forbid = /\b403\b/.test(e?.message || '');
      setNote({
        type: 'err',
        text: forbid
          ? 'Only the pond owner can invite people.'
          : 'That invite didn’t go through. Check the number and try again.',
      });
    } finally {
      setBusy(false);
    }
  }, [api, phone, load]);

  const revoke = useCallback(async (target) => {
    // Optimistic: drop it now, put it back if the server disagrees.
    const previous = invites;
    setInvites((prev) => prev.filter((i) => i.phone !== target));
    try {
      await api.delete(`/auth/invites/${encodeURIComponent(target)}`);
    } catch {
      setInvites(previous);
      setNote({ type: 'err', text: `Could not take ${target} off the list.` });
    }
  }, [api, invites]);

  const makeLink = useCallback(async () => {
    if (linkBusy) return;
    setLinkBusy(true);
    setNote(null);
    try {
      await api.post('/auth/invite-links', {});
      await load();
      setNote({ type: 'ok', text: 'Invite link created — anyone with it can join.' });
    } catch (e) {
      const forbid = /\b403\b/.test(e?.message || '');
      setNote({
        type: 'err',
        text: forbid ? 'Only the pond owner can create invite links.' : 'Could not create an invite link.',
      });
    } finally {
      setLinkBusy(false);
    }
  }, [api, linkBusy, load]);

  const revokeLink = useCallback(async (code) => {
    const previous = links;
    setLinks((prev) => prev.filter((l) => l.code !== code));
    try {
      await api.delete(`/auth/invite-links/${encodeURIComponent(code)}`);
    } catch {
      setLinks(previous);
      setNote({ type: 'err', text: 'Could not revoke that link.' });
    }
  }, [api, links]);

  const handleCopy = useCallback(async (value) => {
    const how = await copyOrShare(value);
    if (how === 'copied') {
      setCopied(value);
      setTimeout(() => setCopied((c) => (c === value ? null : c)), 1800);
    }
  }, []);

  // Not the owner, or not answered yet: render nothing rather than a card that
  // explains a capability this person does not have.
  if (!loaded || forbidden) return null;

  const activeLinks = links.filter((l) => l.active);

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.iconContainer}>
          <Icon name="account-multiple-plus" size={20} color={theme.colors.textPrimary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>Pond members</Text>
          {!!org?.name && <Text style={styles.sectionSub}>{org.name}</Text>}
        </View>
      </View>

      <Text style={styles.hint}>
        Invite someone by phone number and they can sign in with it — the pond
        recognises the number and lets them straight in. Nobody else can.
      </Text>

      <View style={styles.inviteRow}>
        <View style={styles.inputWrap}>
          <Icon name="phone-outline" size={17} color={theme.colors.textTertiary} />
          <TextInput
            style={styles.input}
            placeholder="+1 555 123 4567"
            placeholderTextColor={theme.colors.textPlaceholder}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={invite}
            accessibilityLabel="Phone number to invite"
          />
        </View>
        <TouchableOpacity
          style={[styles.primaryButton, busy && styles.buttonDisabled]}
          onPressIn={() => impactHaptic('medium')}
          onPress={invite}
          disabled={busy}
          activeOpacity={0.8}
        >
          {busy
            ? <ActivityIndicator size="small" color={theme.colors.textPrimary} />
            : <Text style={styles.primaryButtonText}>Invite</Text>}
        </TouchableOpacity>
      </View>

      {!!note && (
        <Text style={[styles.note, note.type === 'err' ? styles.noteErr : styles.noteOk]}>
          {note.text}
        </Text>
      )}

      {/* The join link is surfaced whether or not the text landed — carrier
          registration is the usual reason it doesn't, and the owner can always
          send the link by hand. */}
      {!!result?.joinUrl && (
        <View style={styles.linkCard}>
          <Text style={styles.linkLabel}>Join link for {result.phone}</Text>
          <Text style={styles.linkValue} numberOfLines={2}>{result.joinUrl}</Text>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPressIn={() => tapHaptic()}
            onPress={() => handleCopy(result.joinUrl)}
            activeOpacity={0.8}
          >
            <Icon
              name={copied === result.joinUrl ? 'check' : 'content-copy'}
              size={15}
              color={theme.colors.textPrimary}
            />
            <Text style={styles.secondaryButtonText}>
              {copied === result.joinUrl ? 'Copied' : 'Copy link'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {invites.length > 0 && (
        <>
          <Text style={styles.groupLabel}>Invited</Text>
          {invites.map((i) => (
            <View key={i.phone} style={styles.row}>
              <Icon name="clock-outline" size={16} color={theme.colors.textTertiary} />
              <Text style={styles.rowText} numberOfLines={1}>{i.phone}</Text>
              <TouchableOpacity
                onPressIn={() => notifyHaptic('warning')}
                onPress={() => revoke(i.phone)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel={`Remove the invite for ${i.phone}`}
              >
                <Icon name="close-circle" size={18} color={theme.colors.textTertiary} />
              </TouchableOpacity>
            </View>
          ))}
        </>
      )}

      {members.length > 0 && (
        <>
          <Text style={styles.groupLabel}>Joined</Text>
          {members.map((m) => (
            <View key={m.id} style={styles.row}>
              <Icon name="check-circle-outline" size={16} color={theme.colors.accentSuccess} />
              <Text style={styles.rowText} numberOfLines={1}>{m.phone || m.id}</Text>
              {m.role === 'owner' && <Text style={styles.roleTag}>owner</Text>}
            </View>
          ))}
        </>
      )}

      <Text style={styles.groupLabel}>Invite link</Text>
      <Text style={styles.hint}>
        A link admits whoever opens it, so send it to one person at a time and
        revoke it once they are in.
      </Text>
      {activeLinks.map((l) => (
        <View key={l.code} style={styles.row}>
          <Icon name="link-variant" size={16} color={theme.colors.textTertiary} />
          <Text style={styles.rowText} numberOfLines={1}>{l.codePretty || l.code}</Text>
          <TouchableOpacity
            onPressIn={() => tapHaptic()}
            onPress={() => handleCopy(l.codePretty || l.code)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Copy this invite code"
          >
            <Icon
              name={copied === (l.codePretty || l.code) ? 'check' : 'content-copy'}
              size={17}
              color={theme.colors.textTertiary}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPressIn={() => notifyHaptic('warning')}
            onPress={() => revokeLink(l.code)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Revoke this invite link"
          >
            <Icon name="close-circle" size={18} color={theme.colors.textTertiary} />
          </TouchableOpacity>
        </View>
      ))}
      <TouchableOpacity
        style={[styles.secondaryButton, linkBusy && styles.buttonDisabled]}
        onPressIn={() => tapHaptic()}
        onPress={makeLink}
        disabled={linkBusy}
        activeOpacity={0.8}
      >
        {linkBusy
          ? <ActivityIndicator size="small" color={theme.colors.textPrimary} />
          : <Icon name="link-plus" size={15} color={theme.colors.textPrimary} />}
        <Text style={styles.secondaryButtonText}>Create an invite link</Text>
      </TouchableOpacity>
    </View>
  );
}

const createStyles = (theme) => StyleSheet.create({
  section: {
    backgroundColor: theme.colors.surface,
    borderRadius: 14,
    marginHorizontal: 12,
    marginBottom: 14,
    paddingBottom: 14,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
  },
  iconContainer: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceElevated,
  },
  sectionTitle: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  sectionSub: {
    color: theme.colors.textTertiary,
    fontSize: 12,
    marginTop: 1,
  },
  hint: {
    color: theme.colors.textTertiary,
    fontSize: 12.5,
    lineHeight: 17,
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
  },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    backgroundColor: theme.colors.inputBackground,
    borderRadius: 10,
    // Explicit height with paddingVertical:0 on the field — padding alone makes
    // the glyphs sit high in an icon row.
    height: 42,
  },
  input: {
    flex: 1,
    height: 42,
    paddingVertical: 0,
    textAlignVertical: 'center',
    fontSize: 15,
    color: theme.colors.inputText,
  },
  primaryButton: {
    minWidth: 78,
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    backgroundColor: theme.colors.surfaceHighlight,
  },
  primaryButtonText: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginHorizontal: 14,
    marginTop: 10,
    height: 40,
    borderRadius: 10,
    backgroundColor: theme.colors.surfaceElevated,
  },
  secondaryButtonText: {
    color: theme.colors.textPrimary,
    fontSize: 13.5,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  note: {
    fontSize: 12.5,
    lineHeight: 17,
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  noteOk: {
    color: theme.colors.accentSuccess,
  },
  noteErr: {
    color: theme.colors.accentError,
  },
  linkCard: {
    marginHorizontal: 14,
    marginTop: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: theme.colors.surfaceElevated,
  },
  linkLabel: {
    color: theme.colors.textTertiary,
    fontSize: 11.5,
    marginBottom: 4,
  },
  linkValue: {
    color: theme.colors.textPrimary,
    fontSize: 12.5,
  },
  groupLabel: {
    color: theme.colors.textTertiary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    paddingHorizontal: 14,
    paddingTop: 16,
    paddingBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  rowText: {
    flex: 1,
    color: theme.colors.textPrimary,
    fontSize: 14,
  },
  roleTag: {
    color: theme.colors.textTertiary,
    fontSize: 11,
  },
});
