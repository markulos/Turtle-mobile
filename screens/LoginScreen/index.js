/**
 * LoginScreen - Secure authentication entry point
 *
 * Dark-themed login screen matching the Turtle app aesthetic. Two methods:
 *   • Master password (the owner's existing login).
 *   • Phone number + SMS verification code (Telnyx OTP) — to create/sign into
 *     an account on the mobile app. On a verified code the issued JWT is stored,
 *     which flips isAuthenticated and the app un-gates automatically.
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  SafeAreaView,
  Linking,
} from 'react-native';
import { Image } from 'expo-image';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { useServer, serverOrigin } from '../../context/ServerContext';
import { DismissKeyboardView } from '../../components/KeyboardSafeView';
import { scanForPonds } from '../../services/pondDiscovery';

// Brand turtle, rendered to a 1024px PNG. Was a 6.4 MB auto-traced SVG
// (7,069 hyper-precise paths) bundled into the app for a logo shown at ~120px
// — the PNG is visually identical at display size and ~95% smaller.
const turtleIcon = require('../../assets/turtle-icon.png');

// Quick-pick self-host server addresses for the dev build. Tailscale reaches
// the pond from anywhere (away from home / cellular); the LAN address is the
// fast local path at home. Tapping a chip fills the field AND saves+tests it.
// (Keep in sync with ServerContext.DEFAULT_SERVER_HOST + the iOS dev-build notes.)
const SERVER_PRESETS = [
  { label: 'Tailscale', host: '100.105.43.69', hint: 'away / cellular' },
  { label: 'Home Wi-Fi', host: '192.168.2.93', hint: 'same LAN' },
];

// TEMP single-server phase: invite codes/links are OFF — an owner-invited phone
// just signs in, and the app auto-routes to the one Tailscale pond. Flip to
// true to bring back the invite-code field when multi-server (Discord-style)
// joining lands. Deep-link codes (turtle://join/…) still work regardless.
const INVITES_ENABLED = false;

export default function LoginScreen() {
  const { theme } = useTheme();
  const { login, requestOtp, verifyOtp, loginError, isLoading } = useAuth();
  // Server address — settable HERE, pre-auth. Without this a fresh install
  // (an invitee joining the pond) has an empty serverIP, every auth call dies
  // with "Network request failed", and the Settings editor is locked behind
  // login — a chicken-and-egg they can't escape.
  const { serverIP, saveIP, isConnected } = useServer();
  const [showServerInput, setShowServerInput] = useState(false);
  const [serverInput, setServerInput] = useState('');
  const [serverBusy, setServerBusy] = useState(false);
  const [serverNote, setServerNote] = useState('');
  const [serverNoteOk, setServerNoteOk] = useState(false);
  // Pond discovery (alias search): sweep the LAN once per editor-open for
  // Turtle servers; the input then filters hits by pond name or @alias.
  // Private ponds appear only when the typed phone number is on their invite
  // list (the server enforces that — see /api/auth/pond/info).
  const [ponds, setPonds] = useState([]);
  const [scanning, setScanning] = useState(false);
  // Live narration of the scan (which subnet, device IP, probe totals) —
  // shown in the UI AND console.logged so the Metro log captures the trail.
  const [scanStatus, setScanStatus] = useState('');
  const scanSeqRef = useRef(0);

  const startPondScan = (phoneForScan) => {
    const seq = ++scanSeqRef.current;
    setPonds([]);
    setScanning(true);
    setScanStatus('');
    console.log('[pond-scan] starting; phone supplied:', !!phoneForScan);
    scanForPonds(
      phoneForScan,
      (p) => {
        if (scanSeqRef.current !== seq) return; // a newer scan superseded this one
        setPonds((prev) => (prev.some((x) => x.host === p.host) ? prev : [...prev, p]));
      },
      (msg) => {
        if (scanSeqRef.current === seq) setScanStatus(msg);
      },
    ).finally(() => {
      if (scanSeqRef.current === seq) setScanning(false);
    });
  };

  useEffect(() => {
    if (showServerInput) startPondScan(phone.trim());
    // Deliberately not re-running on every phone keystroke — the Rescan link
    // re-probes with the current number when the user wants private ponds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showServerInput]);

  const [authMode, setAuthMode] = useState('password'); // 'password' | 'phone'

  // Master-password mode
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Phone-OTP mode. Seed with the North-American "+1 " prefix (Telnyx is set up
  // for NA only right now) so the invitee just types their number. normalizePhone
  // is forgiving — a bare 10-digit entry still resolves to +1, so deleting it is
  // harmless.
  const [phone, setPhone] = useState('+1 ');
  const [otpStep, setOtpStep] = useState('phone'); // 'phone' | 'code'
  const [code, setCode] = useState('');
  // Discord-style join: an invite CODE (from a link) or the NAME of an open
  // pond. Optional — phones the owner invited directly can leave it blank.
  const [invite, setInvite] = useState('');
  // Live preview of what the invite resolves to ("🌊 Mark's Pond · 3 turtles"),
  // fetched (debounced) from the public /auth/join/preview endpoint.
  const [invitePreview, setInvitePreview] = useState(null);
  const previewTimerRef = useRef(null);
  const verifyingRef = useRef(false); // guard so autofill auto-submit + a manual tap don't double-fire
  const [busy, setBusy] = useState(false); // local spinner for the send-code call
  const [devCode, setDevCode] = useState(''); // shown only when the server is in dev mode

  const [localError, setLocalError] = useState('');
  const displayError = localError || loginError;

  // Invite deep link: turtle://join/CODE?server=IP. The link carries BOTH the
  // invite code and the server address, so a fresh install that taps an invite
  // is fully configured — no manual server entry, no chicken-and-egg.
  useEffect(() => {
    const handleJoinUrl = (url) => {
      const m = String(url || '').match(/turtle:\/\/join\/([A-Za-z0-9-]{4,24})(?:\?([^#]*))?/i);
      if (!m) return;
      const qs = m[2] || '';
      const serverParam = qs.split('&').map((p) => p.split('=')).find(([k]) => k === 'server');
      if (serverParam && serverParam[1]) {
        const raw = decodeURIComponent(serverParam[1]).trim();
        // URL-shaped server (tunnel) → keep verbatim minus trailing slash;
        // bare host → strip any path / typed :3000 (the port is implied).
        const host = /^https?:\/\//i.test(raw)
          ? raw.replace(/\/+$/, '')
          : raw.replace(/\/.*$/, '').replace(/:3000$/, '');
        if (host) saveIP(host);
      }
      setAuthMode('phone');
      setOtpStep('phone');
      setInvite(m[1]);
      setLocalError('');
    };
    Linking.getInitialURL().then(handleJoinUrl).catch(() => {});
    const sub = Linking.addEventListener('url', (e) => handleJoinUrl(e.url));
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced invite preview — shows the pond you're about to join (or that
  // the invite is a dud) before any SMS is spent.
  useEffect(() => {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    const s = invite.trim();
    if (!serverIP || s.length < 2) { setInvitePreview(null); return undefined; }
    previewTimerRef.current = setTimeout(async () => {
      try {
        setInvitePreview({ checking: true });
        const resp = await fetch(`${serverOrigin(serverIP)}/api/auth/join/preview?invite=${encodeURIComponent(s)}`);
        const data = await resp.json().catch(() => ({}));
        setInvitePreview(data && data.valid
          ? { valid: true, name: data.pond?.name, memberCount: data.pond?.memberCount }
          : { valid: false });
      } catch {
        setInvitePreview(null); // unreachable server — the send button's guard will say so
      }
    }, 450);
    return () => { if (previewTimerRef.current) clearTimeout(previewTimerRef.current); };
  }, [invite, serverIP]);

  const handleLogin = async () => {
    setLocalError('');
    if (!serverIP) {
      setLocalError('Tap the invite link from your text — it sets everything up. (Owners: Advanced below.)');
      return;
    }
    if (!password.trim()) {
      setLocalError('Please enter your password');
      return;
    }
    await login(password);
  };

  // Save + test a server address. Lenient input: a bare host gets http:// and
  // :3000 implied (any typed :3000 or path is stripped); a FULL URL
  // (https://… — a tunnel-style server like Tailscale Funnel) is kept
  // verbatim minus trailing slash, because its scheme and port ARE the
  // address — the old version stripped the scheme and appended :3000, which
  // destroyed every URL the user typed. `hostOverride` (a string) is used by
  // the pond-suggestion taps; button/submit events fall back to the input.
  const handleSaveServer = async (hostOverride) => {
    let v = (typeof hostOverride === 'string' ? hostOverride : serverInput).trim();
    if (/^https?:\/\//i.test(v)) {
      v = v.replace(/\/+$/, '');
    } else {
      v = v.replace(/\/.*$/, '').replace(/:3000$/, '');
    }
    if (!v) return;
    setServerBusy(true);
    setServerNote('');
    const ok = await saveIP(v); // persists, then health-checks
    setServerBusy(false);
    setServerNoteOk(ok);
    if (ok) {
      setServerNote(`Connected to ${v}`);
      setShowServerInput(false);
      setLocalError('');
    } else {
      setServerNote(`Saved, but couldn't reach ${serverOrigin(v)} — check the address and that the server is up.`);
    }
  };

  const handleSendCode = async () => {
    setLocalError('');
    setDevCode('');
    if (!serverIP) {
      setLocalError('Tap the invite link from your text — it sets everything up automatically.');
      return;
    }
    if (!phone.trim()) {
      setLocalError('Enter your phone number');
      return;
    }
    setBusy(true);
    const r = await requestOtp(phone.trim(), invite.trim() || undefined);
    setBusy(false);
    if (r.success) {
      setOtpStep('code');
      setCode('');
      if (r.devCode) setDevCode(r.devCode); // dev mode: surface the code so it's testable
    } else {
      setLocalError(r.error || 'Could not send the code');
    }
  };

  // `codeOverride` (a string) lets the auto-submit + SMS autofill verify the
  // exact value immediately, without waiting for the `code` state to settle.
  // onSubmitEditing/onPress hand us a synthetic event (not a string), so those
  // fall back to the `code` state.
  const handleVerifyCode = async (codeOverride) => {
    setLocalError('');
    const c = (typeof codeOverride === 'string' ? codeOverride : code).trim();
    if (c.length < 6) {
      if (typeof codeOverride !== 'string') setLocalError('Enter the 6-digit code');
      return;
    }
    if (verifyingRef.current) return; // already submitting (autofill fired + user also tapped)
    verifyingRef.current = true;
    // On success AuthContext stores the token → isAuthenticated flips → App.js
    // unmounts this screen automatically, so there's nothing to navigate to here.
    const r = await verifyOtp(phone.trim(), c, invite.trim() || undefined);
    verifyingRef.current = false;
    if (!r.success) setLocalError(r.error || 'Invalid or expired code');
  };

  const switchMode = (mode) => {
    setAuthMode(mode);
    setLocalError('');
    setDevCode('');
    setOtpStep('phone');
    setCode('');
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <DismissKeyboardView style={styles.content}>
          {/* Logo / Icon */}
          <View style={styles.logoContainer}>
            <Image
              source={turtleIcon}
              style={styles.logoImage}
              contentFit="contain"
              tintColor={theme.colors.primary}
            />
            <Text style={[styles.title, { color: theme.colors.textPrimary }]}>Turtle</Text>
            <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
              Secure Command Console
            </Text>
          </View>

          {/* Login Form */}
          <View style={styles.formContainer}>
            {authMode === 'password' ? (
              <>
                <Text style={[styles.label, { color: theme.colors.textSecondary }]}>
                  Enter Master Password
                </Text>

                <View style={[
                  styles.inputContainer,
                  {
                    backgroundColor: theme.colors.inputBackground,
                    borderColor: displayError ? theme.colors.accentError : theme.colors.border,
                  },
                ]}>
                  <Icon name="lock" size={20} color={theme.colors.textMuted} style={styles.inputIcon} />
                  <TextInput
                    style={[styles.input, { color: theme.colors.inputText }]}
                    placeholder="Password"
                    placeholderTextColor={theme.colors.textPlaceholder}
                    secureTextEntry={!showPassword}
                    value={password}
                    onChangeText={setPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!isLoading}
                    onSubmitEditing={handleLogin}
                    returnKeyType="done"
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword(!showPassword)}
                    style={styles.eyeButton}
                    disabled={isLoading}
                  >
                    <Icon name={showPassword ? 'eye-off' : 'eye'} size={20} color={theme.colors.textMuted} />
                  </TouchableOpacity>
                </View>

                {displayError ? (
                  <View style={styles.errorContainer}>
                    <Icon name="alert-circle" size={16} color={theme.colors.accentError} />
                    <Text style={[styles.errorText, { color: theme.colors.accentError }]}>{displayError}</Text>
                  </View>
                ) : null}

                <TouchableOpacity
                  style={[
                    styles.loginButton,
                    {
                      backgroundColor: isLoading ? theme.colors.primaryMuted : theme.colors.primary,
                      opacity: isLoading ? 0.7 : 1,
                    },
                  ]}
                  onPress={handleLogin}
                  disabled={isLoading}
                  activeOpacity={0.8}
                >
                  {isLoading ? (
                    <ActivityIndicator color={theme.colors.background} />
                  ) : (
                    <Text style={[styles.loginButtonText, { color: theme.colors.background }]}>Unlock</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => switchMode('phone')}
                  style={styles.modeToggle}
                  disabled={isLoading}
                  activeOpacity={0.7}
                >
                  <Icon name="cellphone-message" size={16} color={theme.colors.primary} />
                  <Text style={[styles.modeToggleText, { color: theme.colors.primary }]}>
                    Sign in with phone number
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={[styles.label, { color: theme.colors.textSecondary }]}>
                  {otpStep === 'phone' ? 'Phone Number' : 'Verification Code'}
                </Text>

                {otpStep === 'phone' ? (
                  <>
                    <View style={[
                      styles.inputContainer,
                      {
                        backgroundColor: theme.colors.inputBackground,
                        borderColor: displayError ? theme.colors.accentError : theme.colors.border,
                      },
                    ]}>
                      <Icon name="cellphone" size={20} color={theme.colors.textMuted} style={styles.inputIcon} />
                      <TextInput
                        style={[styles.input, { color: theme.colors.inputText }]}
                        placeholder="+1 647 254 9123"
                        placeholderTextColor={theme.colors.textPlaceholder}
                        keyboardType="phone-pad"
                        value={phone}
                        onChangeText={setPhone}
                        autoCapitalize="none"
                        autoCorrect={false}
                        editable={!busy}
                        onSubmitEditing={handleSendCode}
                        returnKeyType="send"
                      />
                    </View>

                    {INVITES_ENABLED && (
                    <>
                    {/* Invite code / open-pond name — optional for phones the
                        owner invited directly; required for everyone else.
                        Prefilled automatically by turtle://join/... links. */}
                    <View style={[
                      styles.inputContainer,
                      styles.inviteInputContainer,
                      { backgroundColor: theme.colors.inputBackground, borderColor: theme.colors.border },
                    ]}>
                      <Icon name="ticket-confirmation-outline" size={20} color={theme.colors.textMuted} style={styles.inputIcon} />
                      <TextInput
                        style={[styles.input, { color: theme.colors.inputText }]}
                        placeholder="Invite code or pond name (optional)"
                        placeholderTextColor={theme.colors.textPlaceholder}
                        value={invite}
                        onChangeText={setInvite}
                        autoCapitalize="none"
                        autoCorrect={false}
                        editable={!busy}
                        onSubmitEditing={handleSendCode}
                        returnKeyType="send"
                      />
                    </View>
                    {invitePreview ? (
                      <Text style={[
                        styles.invitePreview,
                        {
                          color: invitePreview.checking
                            ? theme.colors.textMuted
                            : invitePreview.valid ? theme.colors.accentSuccess : theme.colors.textMuted,
                        },
                      ]}>
                        {invitePreview.checking
                          ? 'Checking invite…'
                          : invitePreview.valid
                            ? `🌊 ${invitePreview.name} · ${invitePreview.memberCount} turtle${invitePreview.memberCount === 1 ? '' : 's'} — you're in the right place`
                            : 'No live invite or open pond matches that — check the code or name'}
                      </Text>
                    ) : null}
                    </>
                    )}
                  </>
                ) : (
                  <View style={[
                    styles.inputContainer,
                    {
                      backgroundColor: theme.colors.inputBackground,
                      borderColor: displayError ? theme.colors.accentError : theme.colors.border,
                    },
                  ]}>
                    <Icon name="shield-key" size={20} color={theme.colors.textMuted} style={styles.inputIcon} />
                    <TextInput
                      style={[styles.input, styles.codeInput, { color: theme.colors.inputText }]}
                      placeholder="123456"
                      placeholderTextColor={theme.colors.textPlaceholder}
                      keyboardType="number-pad"
                      textContentType="oneTimeCode"
                      autoComplete="sms-otp"
                      importantForAutofill="yes"
                      value={code}
                      onChangeText={(t) => {
                        const clean = t.replace(/\D/g, '').slice(0, 6);
                        setCode(clean);
                        // Auto-submit the instant 6 digits land — whether typed
                        // or filled by the OS from the SMS (one-tap sign-in).
                        if (clean.length === 6 && !isLoading) handleVerifyCode(clean);
                      }}
                      maxLength={6}
                      editable={!isLoading}
                      onSubmitEditing={handleVerifyCode}
                      returnKeyType="done"
                      autoFocus
                    />
                  </View>
                )}

                {devCode ? (
                  <Text style={[styles.devHint, { color: theme.colors.textMuted }]}>
                    Dev mode — your code is {devCode}
                  </Text>
                ) : null}

                {displayError ? (
                  <View style={styles.errorContainer}>
                    <Icon name="alert-circle" size={16} color={theme.colors.accentError} />
                    <Text style={[styles.errorText, { color: theme.colors.accentError }]}>{displayError}</Text>
                  </View>
                ) : null}

                {otpStep === 'phone' ? (
                  <TouchableOpacity
                    style={[
                      styles.loginButton,
                      {
                        backgroundColor: busy ? theme.colors.primaryMuted : theme.colors.primary,
                        opacity: busy ? 0.7 : 1,
                      },
                    ]}
                    onPress={handleSendCode}
                    disabled={busy}
                    activeOpacity={0.8}
                  >
                    {busy ? (
                      <ActivityIndicator color={theme.colors.background} />
                    ) : (
                      <Text style={[styles.loginButtonText, { color: theme.colors.background }]}>Send code</Text>
                    )}
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[
                      styles.loginButton,
                      {
                        backgroundColor: isLoading ? theme.colors.primaryMuted : theme.colors.primary,
                        opacity: isLoading ? 0.7 : 1,
                      },
                    ]}
                    onPress={handleVerifyCode}
                    disabled={isLoading}
                    activeOpacity={0.8}
                  >
                    {isLoading ? (
                      <ActivityIndicator color={theme.colors.background} />
                    ) : (
                      <Text style={[styles.loginButtonText, { color: theme.colors.background }]}>Verify &amp; sign in</Text>
                    )}
                  </TouchableOpacity>
                )}

                <View style={styles.linkRow}>
                  {otpStep === 'code' ? (
                    <TouchableOpacity
                      onPress={() => { setOtpStep('phone'); setLocalError(''); setDevCode(''); }}
                      disabled={isLoading}
                    >
                      <Text style={[styles.linkText, { color: theme.colors.textSecondary }]}>Change number</Text>
                    </TouchableOpacity>
                  ) : (
                    <View />
                  )}
                  <TouchableOpacity onPress={() => switchMode('password')} disabled={busy || isLoading}>
                    <Text style={[styles.linkText, { color: theme.colors.textSecondary }]}>Use master password</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            {/* Server address — tappable status row, expands to an inline
                editor. THE entry point for an invitee's first connection. */}
            {showServerInput ? (
              <>
                <View style={styles.serverEditRow}>
                  <View style={[
                    styles.inputContainer,
                    { flex: 1, height: 46, backgroundColor: theme.colors.inputBackground, borderColor: theme.colors.border },
                  ]}>
                    <Icon name="magnify" size={18} color={theme.colors.textMuted} style={styles.inputIcon} />
                    <TextInput
                      style={[styles.input, { color: theme.colors.inputText, fontSize: 14 }]}
                      placeholder="Pond name, alias, or IP"
                      placeholderTextColor={theme.colors.textPlaceholder}
                      value={serverInput}
                      onChangeText={setServerInput}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                      editable={!serverBusy}
                      onSubmitEditing={handleSaveServer}
                      returnKeyType="done"
                      autoFocus
                    />
                  </View>
                  <TouchableOpacity
                    style={[styles.serverSaveBtn, { backgroundColor: theme.colors.primary, opacity: serverBusy ? 0.7 : 1 }]}
                    onPress={handleSaveServer}
                    disabled={serverBusy}
                  >
                    {serverBusy
                      ? <ActivityIndicator size="small" color={theme.colors.background} />
                      : <Icon name="check" size={18} color={theme.colors.background} />}
                  </TouchableOpacity>
                </View>

                {/* Quick-pick presets — Tailscale (away) + Home LAN. Tapping
                    one fills the field and saves+tests that address straight
                    away, so the dev build can switch networks in one tap. */}
                <View style={styles.presetRow}>
                  {SERVER_PRESETS.map((p) => {
                    const active = serverIP === p.host;
                    return (
                      <TouchableOpacity
                        key={p.host}
                        style={[
                          styles.presetChip,
                          {
                            borderColor: active ? theme.colors.primary : theme.colors.border,
                            backgroundColor: active ? theme.colors.primaryMuted : 'transparent',
                          },
                        ]}
                        onPress={() => { setServerInput(p.host); handleSaveServer(p.host); }}
                        disabled={serverBusy}
                        activeOpacity={0.8}
                      >
                        <Icon
                          name={p.host.startsWith('100.') ? 'shield-lock-outline' : 'wifi'}
                          size={13}
                          color={active ? theme.colors.primary : theme.colors.textSecondary}
                        />
                        <Text style={[styles.presetChipText, { color: active ? theme.colors.primary : theme.colors.textSecondary }]}>
                          {p.label}
                        </Text>
                        <Text style={[styles.presetChipHost, { color: theme.colors.textMuted }]}>
                          {p.host}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Discovered ponds — filtered by the query against name/alias.
                    Tapping one saves + tests its address. Private ponds only
                    appear if the typed phone is on that pond's invite list. */}
                {(() => {
                  const q = serverInput.trim().toLowerCase();
                  const qIsAddress = /^[0-9.:]*$/.test(q); // typing an IP → don't filter the list away
                  const matches = ponds
                    .filter((p) => !q || qIsAddress
                      || (p.name || '').toLowerCase().includes(q)
                      || (p.alias || '').toLowerCase().includes(q))
                    .slice(0, 4);
                  return (
                    <View style={styles.pondList}>
                      {matches.map((p) => (
                        <TouchableOpacity
                          key={p.host}
                          style={[styles.pondRow, { backgroundColor: theme.colors.inputBackground, borderColor: theme.colors.border }]}
                          onPress={() => handleSaveServer(p.host)}
                          disabled={serverBusy}
                          activeOpacity={0.7}
                        >
                          <Text style={{ fontSize: 16 }}>🌊</Text>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={[styles.pondName, { color: theme.colors.textPrimary }]} numberOfLines={1}>
                              {p.name || 'Turtle pond'}
                              {p.alias ? <Text style={{ color: theme.colors.textMuted, fontWeight: '400' }}>  @{p.alias}</Text> : null}
                            </Text>
                            <Text style={[styles.pondSub, { color: theme.colors.textMuted }]} numberOfLines={1}>
                              {p.host} · {p.memberCount} turtle{p.memberCount === 1 ? '' : 's'}
                              {!p.discoverable && p.invited ? ' · private — you\'re invited' : ''}
                            </Text>
                          </View>
                          <Icon name="chevron-right" size={18} color={theme.colors.textMuted} />
                        </TouchableOpacity>
                      ))}
                      <View style={styles.pondScanRow}>
                        {scanning ? (
                          <>
                            <ActivityIndicator size="small" color={theme.colors.textMuted} />
                            <Text style={[styles.pondSub, { color: theme.colors.textMuted, marginLeft: 8 }]}>
                              Scanning your Wi-Fi for ponds…
                            </Text>
                          </>
                        ) : (
                          <>
                            <Text style={[styles.pondSub, { color: theme.colors.textMuted, flex: 1 }]}>
                              {ponds.length === 0
                                ? 'No ponds found on this network.'
                                : !phone.trim()
                                  ? 'Tip: type your phone number above, then rescan to see private ponds you\'re invited to.'
                                  : `${ponds.length} pond${ponds.length === 1 ? '' : 's'} found.`}
                            </Text>
                            <TouchableOpacity onPress={() => startPondScan(phone.trim())} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                              <Text style={[styles.pondSub, { color: theme.colors.textSecondary, textDecorationLine: 'underline' }]}>Rescan</Text>
                            </TouchableOpacity>
                          </>
                        )}
                      </View>
                      {/* Scan diagnostics — what the scan actually did (device
                          IP, subnet swept, probe totals). The fastest tell:
                          a 10.x / 100.x device IP = the phone is on CELLULAR
                          and the Wi-Fi scan can't work. */}
                      {!!scanStatus && (
                        <Text style={[styles.pondSub, { color: theme.colors.textMuted, paddingHorizontal: 4, marginTop: 2 }]}>
                          {scanStatus}
                        </Text>
                      )}
                    </View>
                  );
                })()}
              </>
            ) : serverIP ? (
              <TouchableOpacity
                style={styles.serverRow}
                onPress={() => { setServerInput(serverIP); setServerNote(''); setShowServerInput(true); }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <View style={[styles.statusDot, { backgroundColor: isConnected ? '#4ADE80' : '#F87171' }]} />
                <Text style={[styles.serverRowText, { color: theme.colors.textMuted }]}>
                  {`Server: ${serverIP}`}
                </Text>
                <Icon name="pencil-outline" size={13} color={theme.colors.textMuted} />
              </TouchableOpacity>
            ) : (
              /* No server linked yet — the EXPECTED path is the invite text's
                 tap-to-join link (it carries server + code). Manual entry is
                 demoted to an Advanced affordance for owners / edge cases. */
              <View style={{ marginTop: 16, alignItems: 'center' }}>
                <Text style={[styles.invitedHint, { color: theme.colors.textMuted }]}>
                  Invited by text? Tap the link in that message — it sets up the server for you.
                </Text>
                <TouchableOpacity
                  onPress={() => { setServerInput(''); setServerNote(''); setShowServerInput(true); }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={{ marginTop: 8 }}
                >
                  <Text style={[styles.advancedLink, { color: theme.colors.textSecondary }]}>
                    Advanced · set server manually
                  </Text>
                </TouchableOpacity>
              </View>
            )}
            {serverNote ? (
              <Text style={[styles.serverNote, { color: serverNoteOk ? '#4ADE80' : theme.colors.accentError }]}>
                {serverNote}
              </Text>
            ) : null}
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            <Text style={[styles.footerText, { color: theme.colors.textMuted }]}>
              Secure End-to-End Encrypted
            </Text>
            <Icon name="shield-check" size={14} color={theme.colors.textMuted} />
          </View>
        </DismissKeyboardView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 48,
  },
  logoImage: {
    width: 120,
    height: 120,
    marginBottom: 8,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 14,
    marginTop: 4,
    letterSpacing: 0.3,
  },
  formContainer: {
    width: '100%',
  },
  label: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    marginLeft: 4,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 52,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    height: '100%',
  },
  codeInput: {
    letterSpacing: 8,
    fontSize: 20,
    fontWeight: '600',
  },
  inviteInputContainer: {
    marginTop: 10,
  },
  invitePreview: {
    fontSize: 12,
    marginTop: 8,
    marginLeft: 4,
    lineHeight: 17,
  },
  eyeButton: {
    padding: 4,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    marginLeft: 4,
  },
  errorText: {
    fontSize: 13,
    marginLeft: 6,
  },
  loginButton: {
    height: 52,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 24,
  },
  loginButtonText: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  modeToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 20,
  },
  modeToggleText: {
    fontSize: 14,
    fontWeight: '600',
  },
  devHint: {
    fontSize: 12,
    marginTop: 10,
    marginLeft: 4,
  },
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 18,
  },
  linkText: {
    fontSize: 13,
  },
  hint: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 16,
  },
  serverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 16,
    paddingVertical: 4,
  },
  serverRowText: {
    fontSize: 12,
    letterSpacing: 0.2,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  serverEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    gap: 8,
  },
  serverSaveBtn: {
    width: 46,
    height: 46,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  presetRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  presetChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  presetChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  presetChipHost: {
    fontSize: 11,
    marginLeft: 'auto',
  },
  serverNote: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 17,
  },
  invitedHint: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 12,
  },
  advancedLink: {
    fontSize: 12,
    textDecorationLine: 'underline',
  },
  pondList: {
    marginTop: 8,
  },
  pondRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 6,
  },
  pondName: {
    fontSize: 14,
    fontWeight: '600',
  },
  pondSub: {
    fontSize: 11,
    marginTop: 1,
  },
  pondScanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    paddingHorizontal: 4,
    minHeight: 22,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 24,
    gap: 6,
  },
  footerText: {
    fontSize: 11,
    letterSpacing: 0.3,
  },
});
