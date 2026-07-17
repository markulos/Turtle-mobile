import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { tapHaptic, impactHaptic } from '../../../utils/haptics';

// Two-step unlock:
//   • Biometrics (if enrolled + a master password was saved) → unlock directly,
//     no SMS code (the biometric IS the second factor).
//   • Master-password FALLBACK → verify the password (decrypts an entry), then a
//     one-time SMS code texted to the user's phone (2FA) before finalizing.
export const UnlockScreen = ({
  tryPassword,
  finishUnlock,
  requestOtp,
  verifyOtp,
  biometricUnlock,
  saveBiometric,
  bioAvailable,
  bioHasSaved,
  autoBioArmed,
  isProcessing,
}) => {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = createStyles(theme, insets, isDark);

  const [step, setStep] = useState('password'); // 'password' | 'otp'
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [code, setCode] = useState('');
  const [otpInfo, setOtpInfo] = useState(null); // { dev, devCode } in OTP_DEV_MODE
  const [verifiedPw, setVerifiedPw] = useState('');

  const handleBiometric = useCallback(async () => {
    setError('');
    const r = await biometricUnlock();
    // On success the hook flips isUnlocked and this screen unmounts. 'cancelled'
    // is silent (user dismissed the prompt); other errors surface so they can
    // fall back to the master password.
    if (!r.ok && r.error && r.error !== 'cancelled') setError(r.error);
  }, [biometricUnlock]);

  // After a successful master-password unlock, offer to enable biometrics.
  const offerBiometric = useCallback(async (pw) => {
    if (!bioAvailable || bioHasSaved) return;
    return new Promise((resolve) => {
      Alert.alert(
        'Enable biometric unlock?',
        'Use Face/Touch ID to unlock next time. Your master password (with an SMS code) stays as the fallback.',
        [
          { text: 'Not now', style: 'cancel', onPress: () => resolve() },
          { text: 'Enable', onPress: async () => { await saveBiometric(pw); resolve(); } },
        ],
      );
    });
  }, [bioAvailable, bioHasSaved, saveBiometric]);

  const handlePassword = useCallback(async () => {
    if (!password || busy) return;
    setError(''); setBusy(true);
    try {
      const ok = await tryPassword(password);
      if (!ok) { setError('Wrong master password.'); return; }
      setVerifiedPw(password);
      // Password is correct — now require the SMS 2FA step-up.
      const sent = await requestOtp();
      if (!sent.ok) {
        // No phone on file / SMS unavailable → finalize with the password alone
        // (still a required factor). Surface why 2FA was skipped.
        setError(sent.error || 'Could not send a code — unlocked with password only.');
        await finishUnlock(password);
        await offerBiometric(password);
        return;
      }
      setOtpInfo({ dev: sent.dev, devCode: sent.devCode });
      setStep('otp');
    } finally {
      setBusy(false);
    }
  }, [password, busy, tryPassword, requestOtp, finishUnlock, offerBiometric]);

  const handleVerifyOtp = useCallback(async () => {
    if (!code || busy) return;
    setError(''); setBusy(true);
    try {
      const v = await verifyOtp(code);
      if (!v.ok) { setError(v.error || 'Invalid or expired code.'); return; }
      await finishUnlock(verifiedPw);
      await offerBiometric(verifiedPw);
    } finally {
      setBusy(false);
    }
  }, [code, busy, verifyOtp, finishUnlock, verifiedPw, offerBiometric]);

  const handleResend = useCallback(async () => {
    setError('');
    const sent = await requestOtp();
    if (!sent.ok) setError(sent.error || 'Could not resend the code.');
    else setOtpInfo({ dev: sent.dev, devCode: sent.devCode });
  }, [requestOtp]);

  // Auto-offer biometric unlock ONLY when armed — i.e. the app was closed while
  // the vault was open. A manual lock leaves autoBioArmed false, so the user must
  // tap the biometric button (or enter the master password) themselves. Guarded
  // by a ref so it fires at most once even though autoBioArmed may flip true
  // asynchronously after the cold-start storage read.
  const autoBioFired = useRef(false);
  useEffect(() => {
    if (autoBioArmed && bioAvailable && bioHasSaved && !autoBioFired.current) {
      autoBioFired.current = true;
      handleBiometric();
    }
  }, [autoBioArmed, bioAvailable, bioHasSaved, handleBiometric]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.content}>
          <View style={styles.iconContainer}>
            <Icon name={step === 'otp' ? 'message-text-lock' : 'shield-lock'} size={60} color={theme.colors.textPrimary} />
          </View>

          {step === 'password' ? (
            <>
              <Text style={styles.title}>Unlock Vault</Text>
              <Text style={styles.subtitle}>Enter your master password to view your passwords</Text>
              {!!error && <Text style={styles.errorText}>{error}</Text>}

              {bioAvailable && bioHasSaved && (
                <TouchableOpacity style={styles.bioButton} onPressIn={() => impactHaptic('medium')} onPress={handleBiometric} disabled={busy}>
                  <Icon name="fingerprint" size={22} color={theme.colors.textPrimary} />
                  <Text style={styles.bioButtonText}>Unlock with biometrics</Text>
                </TouchableOpacity>
              )}

              <View style={styles.inputContainer}>
                <Icon name="lock" size={20} color={theme.colors.textTertiary} />
                <TextInput
                  style={styles.input}
                  placeholder="Master Password"
                  placeholderTextColor={theme.colors.textPlaceholder}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  onSubmitEditing={handlePassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                  <Icon name={showPassword ? 'eye-off' : 'eye'} size={20} color={theme.colors.textTertiary} />
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[styles.button, (!password || busy || isProcessing) && styles.buttonDisabled]}
                onPressIn={() => impactHaptic('medium')}
                onPress={handlePassword}
                disabled={!password || busy || isProcessing}
              >
                {(busy || isProcessing) ? <ActivityIndicator color={theme.colors.textPrimary} /> : <Text style={styles.buttonText}>Unlock</Text>}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.title}>Verify it's you</Text>
              <Text style={styles.subtitle}>We texted a 6-digit code to your phone. Enter it to finish unlocking.</Text>
              {otpInfo?.dev && otpInfo?.devCode ? (
                <Text style={styles.devCode}>Dev mode — code: {otpInfo.devCode}</Text>
              ) : null}
              {!!error && <Text style={styles.errorText}>{error}</Text>}

              <View style={styles.inputContainer}>
                <Icon name="message-text" size={20} color={theme.colors.textTertiary} />
                <TextInput
                  style={styles.input}
                  placeholder="6-digit code"
                  placeholderTextColor={theme.colors.textPlaceholder}
                  value={code}
                  onChangeText={(t) => setCode(t.replace(/[^0-9]/g, '').slice(0, 6))}
                  keyboardType="number-pad"
                  onSubmitEditing={handleVerifyOtp}
                  maxLength={6}
                  autoFocus
                />
              </View>

              <TouchableOpacity
                style={[styles.button, (!code || busy) && styles.buttonDisabled]}
                onPressIn={() => impactHaptic('medium')}
                onPress={handleVerifyOtp}
                disabled={!code || busy}
              >
                {busy ? <ActivityIndicator color={theme.colors.textPrimary} /> : <Text style={styles.buttonText}>Verify & unlock</Text>}
              </TouchableOpacity>

              <View style={styles.linkRow}>
                <TouchableOpacity onPressIn={() => tapHaptic()} onPress={handleResend}><Text style={styles.linkText}>Resend code</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => { setStep('password'); setCode(''); setError(''); }}><Text style={styles.linkText}>Back</Text></TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const createStyles = (theme, insets, isDark) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    scrollContent: { flexGrow: 1 },
    content: { flex: 1, justifyContent: 'center', padding: 24, minHeight: 400 },
    iconContainer: { alignSelf: 'center', marginBottom: 32 },
    title: { fontSize: 24, fontWeight: '700', color: theme.colors.textPrimary, textAlign: 'center', marginBottom: 8 },
    subtitle: { fontSize: 14, color: theme.colors.textSecondary, textAlign: 'center', marginBottom: 24, paddingHorizontal: 12 },
    errorText: { fontSize: 14, color: theme.colors.accentError, textAlign: 'center', marginBottom: 16, paddingHorizontal: 24 },
    devCode: { fontSize: 13, color: theme.colors.accentInfo, textAlign: 'center', marginBottom: 12, fontWeight: '600' },
    bioButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      height: 48,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceElevated,
      marginBottom: 16,
    },
    bioButtonText: { color: theme.colors.textPrimary, fontSize: 15, fontWeight: '600' },
    inputContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.inputBackground,
      borderRadius: 8,
      paddingHorizontal: 16,
      marginBottom: 16,
    },
    input: { flex: 1, height: 48, marginLeft: 12, fontSize: 16, color: theme.colors.inputText },
    button: {
      backgroundColor: theme.colors.surfaceElevated,
      height: 48,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { color: theme.colors.textPrimary, fontSize: 16, fontWeight: '600' },
    linkRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 18, paddingHorizontal: 8 },
    linkText: { color: theme.colors.textSecondary, fontSize: 14, fontWeight: '600' },
  });
