import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, ActivityIndicator, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Alert, useToast } from './ui';
import { useAuth } from '../context/AuthContext';
import { ApiError, authAPI } from '../services/api';
import { useDialog } from './common/dialogs';
import { ScreenHeader } from './common/layout';

interface MultiFactorAuthProps {
  navigation: any;
}

type Step = 'overview' | 'scan' | 'done';

/** Multi-factor authentication setup (authenticator app / TOTP). */
export function MultiFactorAuth({ navigation }: MultiFactorAuthProps) {
  const { mfa, refresh, biometricAvailable } = useAuth();
  const { showToast } = useToast();
  const { notice, confirm } = useDialog();
  const [step, setStep] = useState<Step>('overview');
  const [secret, setSecret] = useState('');
  const [otpauthUrl, setOtpauthUrl] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const { data } = await authAPI.beginMfaSetup();
      setSecret(data.secret);
      setOtpauthUrl(data.otpauth_url);
      setStep('scan');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not start setup');
    } finally {
      setBusy(false);
    }
  };

  const enable = async () => {
    setBusy(true);
    setError('');
    try {
      const { data } = await authAPI.enableMfa(code);
      await refresh();
      setStep('done');
      await notice({
        title: 'Save your backup codes',
        message: 'Each code signs you in once if you lose your phone. They are shown only now — copy them to a password manager or print them.',
        codes: data.backup_codes,
      });
      showToast('Two-step verification is on', 'success');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Verification failed');
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!(await confirm({ title: 'Turn off two-step verification?', message: 'Your account will be protected by your password only.', confirmText: 'Turn off', destructive: true }))) return;
    setBusy(true);
    setError('');
    try {
      await authAPI.disableMfa(password);
      setPassword('');
      await refresh();
      showToast('Two-step verification turned off', 'warning');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not turn off MFA');
    } finally {
      setBusy(false);
    }
  };

  const grouped = secret.replace(/(.{4})/g, '$1 ').trim();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Two-step verification" subtitle={mfa.enabled ? 'Enabled' : 'Not enabled'} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {step === 'overview' ? (
          <>
            <Card style={styles.card}>
              <CardHeader>
                <View style={styles.row}>
                  <Text style={styles.methodIcon}>📲</Text>
                  <View style={{ flex: 1 }}>
                    <CardTitle>Authenticator app</CardTitle>
                    <Text style={styles.muted}>Google Authenticator, Microsoft Authenticator, Authy, 1Password…</Text>
                  </View>
                  <Badge variant={mfa.enabled ? 'success' : 'outline'}>{mfa.enabled ? 'On' : 'Off'}</Badge>
                </View>
              </CardHeader>
              <CardContent>
                {mfa.enabled ? (
                  <>
                    <Text style={styles.body}>
                      Sign-in asks for a 6-digit code after your password. {mfa.backup_codes_remaining} backup code(s) remain.
                    </Text>
                    <Button variant="outline" onPress={() => navigation.navigate('BackupCodesNew', { mode: 'manage' })} style={styles.button}>
                      Manage backup codes
                    </Button>
                    <Text style={styles.label}>Turn off (confirm password)</Text>
                    <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry placeholder="Current password" placeholderTextColor="#94a3b8" />
                    <Button variant="destructive" onPress={disable} disabled={!password || busy} style={styles.button}>
                      Turn off two-step verification
                    </Button>
                  </>
                ) : (
                  <>
                    <Text style={styles.body}>Adds a second step at sign-in so a stolen password alone cannot open patient records.</Text>
                    <Button onPress={start} loading={busy} style={styles.button}>
                      Set up authenticator app
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>

            <Card style={styles.card}>
              <CardHeader>
                <View style={styles.row}>
                  <Text style={styles.methodIcon}>👆</Text>
                  <View style={{ flex: 1 }}>
                    <CardTitle>Biometric unlock</CardTitle>
                    <Text style={styles.muted}>Fingerprint / Face ID on this device</Text>
                  </View>
                  <Badge variant={biometricAvailable ? 'secondary' : 'outline'}>{biometricAvailable ? 'Available' : 'Not available'}</Badge>
                </View>
              </CardHeader>
              <CardContent>
                <Text style={styles.body}>
                  Unlocks your saved session on this device instead of typing your password. Turn it on in Settings → Security.
                </Text>
              </CardContent>
            </Card>

            {[
              { icon: '💬', title: 'SMS codes', reason: 'Requires an SMS gateway, which is not configured for this deployment.' },
              { icon: '✉️', title: 'Email codes', reason: 'Requires an email gateway, which is not configured for this deployment.' },
              { icon: '🔑', title: 'Security key (WebAuthn)', reason: 'Hardware security keys are not supported yet.' },
            ].map((method) => (
              <Card key={method.title} style={{ ...styles.card, ...styles.disabledCard }}>
                <CardContent style={styles.row}>
                  <Text style={styles.methodIcon}>{method.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title}>{method.title}</Text>
                    <Text style={styles.muted}>{method.reason}</Text>
                  </View>
                  <Badge variant="outline">Unavailable</Badge>
                </CardContent>
              </Card>
            ))}
          </>
        ) : null}

        {step === 'scan' ? (
          <Card style={styles.card}>
            <CardHeader>
              <CardTitle>1. Add NeuroLock to your authenticator</CardTitle>
            </CardHeader>
            <CardContent>
              <Text style={styles.body}>In your authenticator app choose “Add account” → “Enter a setup key” and type or paste this key (time-based):</Text>
              <TouchableOpacity
                style={styles.secretBox}
                onPress={async () => {
                  await Clipboard.setStringAsync(secret);
                  showToast('Setup key copied', 'success');
                }}
              >
                <Text style={styles.secret} selectable>
                  {grouped}
                </Text>
                <Text style={styles.copyHint}>Tap to copy</Text>
              </TouchableOpacity>
              {Platform.OS !== 'web' ? (
                <Text style={styles.muted}>On this phone you can also copy the full setup link: </Text>
              ) : null}
              <TouchableOpacity
                onPress={async () => {
                  await Clipboard.setStringAsync(otpauthUrl);
                  showToast('Setup link copied', 'success');
                }}
              >
                <Text style={styles.link}>Copy otpauth:// setup link</Text>
              </TouchableOpacity>

              <Text style={[styles.body, { marginTop: 20, fontWeight: '600' }]}>2. Enter the 6-digit code it shows</Text>
              <TextInput
                style={[styles.input, styles.codeInput]}
                value={code}
                onChangeText={(text) => setCode(text.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                placeholder="123456"
                placeholderTextColor="#94a3b8"
                maxLength={6}
                onSubmitEditing={enable}
              />
              <Button onPress={enable} disabled={code.length !== 6 || busy} style={styles.button}>
                {busy ? <ActivityIndicator color="#fff" /> : 'Verify and turn on'}
              </Button>
              <Button variant="ghost" onPress={() => setStep('overview')} style={styles.button}>
                Cancel
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {step === 'done' ? (
          <Card style={styles.card}>
            <CardContent style={styles.done}>
              <Text style={styles.doneIcon}>✅</Text>
              <Text style={styles.title}>Two-step verification is on</Text>
              <Text style={styles.body}>From your next sign-in you will be asked for a code from your authenticator app.</Text>
              <Button onPress={() => navigation.goBack()} style={styles.button}>
                Done
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {error ? <Alert variant="destructive" description={error} style={styles.card} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 16, paddingBottom: 40, maxWidth: 640, width: '100%', alignSelf: 'center' },
  card: { marginBottom: 12 },
  disabledCard: { opacity: 0.6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  methodIcon: { fontSize: 28 },
  title: { fontSize: 16, fontWeight: '600', color: '#0f172a' },
  muted: { fontSize: 13, color: '#64748b', marginTop: 2 },
  body: { fontSize: 14, color: '#334155', lineHeight: 20, marginBottom: 12 },
  label: { fontSize: 13, fontWeight: '600', color: '#334155', marginTop: 16, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: '#0f172a', backgroundColor: '#fff' },
  codeInput: { fontSize: 24, letterSpacing: 6, textAlign: 'center' },
  button: { marginTop: 12, paddingVertical: 12 },
  secretBox: { backgroundColor: '#f1f5f9', borderRadius: 10, padding: 16, alignItems: 'center', marginBottom: 12 },
  secret: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 18, letterSpacing: 1, color: '#0f172a', textAlign: 'center' },
  copyHint: { fontSize: 12, color: '#64748b', marginTop: 6 },
  link: { color: '#2563eb', fontWeight: '600', fontSize: 14 },
  done: { alignItems: 'center', paddingVertical: 24 },
  doneIcon: { fontSize: 44, marginBottom: 8 },
});
