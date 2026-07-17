import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
// expo-camera is a NATIVE module: it only works in a dev client built AFTER it
// was added. We DYNAMICALLY import it inside the probe (not at module top) so
// this screen — and the whole Turtle tab that mounts it — can never crash on an
// older build; if the import or the native permission call throws, we fall back
// to a friendly "update the app" screen.
import { useTheme } from '../../../context/ThemeContext';
import { useServer, getApiAuthToken } from '../../../context/ServerContext';
import { notifyHaptic, tapHaptic } from '../../../utils/haptics';

// "Link a desktop": scan the QR shown by the Turtle DESKTOP app's sign-in
// screen and approve it — the desktop then signs in as you (WhatsApp-Web style).
// The QR payload is `{ t:'turtle-login', v, c:<code>, s:<serverOrigin> }`.
export default function LinkDesktop({ visible, onClose }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const insets = useSafeAreaInsets();
  const { getBaseUrl } = useServer();

  // null = checking, true = native camera present, false = needs an app update.
  const [available, setAvailable] = useState(null);
  const [granted, setGranted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { ok:true } | { error:string }
  const [cam, setCam] = useState(null); // the loaded expo-camera module (or null)
  const scannedRef = useRef(false);

  // Load expo-camera + ask for permission. If the module isn't in this build
  // (or the native permission call throws), we show the update-needed fallback.
  const probe = useCallback(async () => {
    try {
      const mod = await import('expo-camera');
      const perm = await mod.Camera.requestCameraPermissionsAsync();
      setCam(mod);
      setAvailable(true);
      setGranted(perm?.status === 'granted');
    } catch {
      setAvailable(false);
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    // Reset per-open and re-probe.
    scannedRef.current = false;
    setResult(null);
    setBusy(false);
    setAvailable(null);
    setGranted(false);
    setCam(null);
    probe();
  }, [visible, probe]);

  const approve = useCallback(async (code) => {
    setBusy(true);
    try {
      // Approve against THIS phone's own server (the desktop's session lives in
      // the shared server memory, keyed by the one-time code) — most reliable,
      // since the phone knows it can reach its own host.
      const base = getBaseUrl(); // …/api
      const token = getApiAuthToken();
      const res = await fetch(`${base}/auth/qr/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.success) {
        setResult({ ok: true });
        notifyHaptic('success');
      } else {
        setResult({ error: d.message || 'Could not sign in the desktop.' });
        scannedRef.current = false; // let them try again
      }
    } catch {
      setResult({ error: 'Network error — is your Turtle server reachable?' });
      scannedRef.current = false;
    } finally {
      setBusy(false);
    }
  }, [getBaseUrl]);

  const onBarcode = useCallback(({ data }) => {
    if (scannedRef.current || busy || result) return;
    let parsed;
    try { parsed = JSON.parse(data); } catch { return; }
    if (!parsed || parsed.t !== 'turtle-login' || !parsed.c) return; // ignore non-Turtle QRs
    scannedRef.current = true;
    tapHaptic();
    Alert.alert(
      'Sign in a desktop?',
      'Approve a Turtle desktop app to sign in as you.',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => { scannedRef.current = false; } },
        { text: 'Sign in', onPress: () => approve(String(parsed.c)) },
      ],
    );
  }, [approve, busy, result]);

  const Header = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: insets.top + 6, paddingBottom: 10, paddingHorizontal: 10 }}>
      <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="Close">
        <Icon name="chevron-left" size={28} color={c.textPrimary} />
      </TouchableOpacity>
      <Text style={{ fontSize: 17, fontWeight: '700', color: c.textPrimary }}>Link a desktop</Text>
    </View>
  );

  const centre = (children) => (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 }}>{children}</View>
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <View style={{ flex: 1, backgroundColor: c.background }}>
        {Header}

        {result?.ok ? centre(
          <>
            <Icon name="check-circle" size={56} color={c.accentSuccess} />
            <Text style={{ fontSize: 17, fontWeight: '700', color: c.textPrimary }}>Desktop signed in</Text>
            <Text style={{ fontSize: 14, color: c.textSecondary, textAlign: 'center' }}>Your Turtle desktop app is now signed in as you.</Text>
            <TouchableOpacity onPress={onClose} style={{ marginTop: 10, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 12, backgroundColor: c.accentInfo }}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>Done</Text>
            </TouchableOpacity>
          </>,
        ) : available === null ? centre(
          <ActivityIndicator color={c.textSecondary} />,
        ) : available === false ? centre(
          <>
            <Icon name="update" size={52} color={c.accentWarning} />
            <Text style={{ fontSize: 16, fontWeight: '700', color: c.textPrimary, textAlign: 'center' }}>QR scanning needs an app update</Text>
            <Text style={{ fontSize: 14, color: c.textSecondary, textAlign: 'center', lineHeight: 20 }}>
              This build doesn&rsquo;t include the camera scanner yet. Rebuild the Turtle app (it now bundles the QR scanner) and this will start working.
            </Text>
          </>,
        ) : !granted ? centre(
          <>
            <Icon name="camera-off-outline" size={52} color={c.textTertiary} />
            <Text style={{ fontSize: 16, fontWeight: '700', color: c.textPrimary }}>Camera permission needed</Text>
            <Text style={{ fontSize: 14, color: c.textSecondary, textAlign: 'center' }}>Allow camera access to scan the desktop&rsquo;s sign-in QR code.</Text>
            <TouchableOpacity onPress={probe} style={{ marginTop: 6, paddingHorizontal: 20, paddingVertical: 11, borderRadius: 12, backgroundColor: c.accentInfo }}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>Allow camera</Text>
            </TouchableOpacity>
          </>,
        ) : (
          <View style={{ flex: 1 }}>
            {cam?.CameraView && (
              <cam.CameraView
                style={{ flex: 1 }}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={busy || result ? undefined : onBarcode}
              />
            )}
            {/* Framing + instructions overlay. */}
            <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ width: 230, height: 230, borderRadius: 20, borderWidth: 3, borderColor: 'rgba(255,255,255,0.9)' }} />
            </View>
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + 30, alignItems: 'center', paddingHorizontal: 30 }}>
              <View style={{ backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 14 }}>
                <Text style={{ color: '#fff', fontSize: 14, textAlign: 'center', lineHeight: 20 }}>
                  On your computer, open Turtle and choose{'\n'}<Text style={{ fontWeight: '700' }}>Scan a QR with your phone</Text> — then point here.
                </Text>
              </View>
            </View>
            {busy && (
              <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)' }}>
                <ActivityIndicator color="#fff" size="large" />
              </View>
            )}
            {result?.error && (
              <View style={{ position: 'absolute', top: insets.top + 54, left: 20, right: 20, backgroundColor: c.accentError, padding: 12, borderRadius: 12 }}>
                <Text style={{ color: '#fff', fontSize: 13, textAlign: 'center' }}>{result.error}</Text>
              </View>
            )}
          </View>
        )}
      </View>
    </Modal>
  );
}
