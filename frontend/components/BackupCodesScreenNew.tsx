import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card.native';
import { Alert } from './ui/alert.native';
import { Input } from './ui/input.native';
import { Button } from './ui/button.native';
import { useToast } from './ui';
import { useAuth } from '../context/AuthContext';
import { useDialog } from './common/dialogs';
import { ApiError, authAPI } from '../services/api';

interface BackupCodesScreenNewProps {
  navigation: any;
  route: any;
}

/**
 * Backup (recovery) codes.
 *  - During sign-in: redeem a single-use code instead of the authenticator code.
 *  - When signed in: see how many codes remain and generate a fresh set.
 */
export function BackupCodesScreenNew({ navigation, route }: BackupCodesScreenNewProps) {
  const { status } = useAuth();
  const loginMode = route?.params?.mode === 'login' || status === 'mfa';
  return loginMode ? <RedeemBackupCode navigation={navigation} /> : <ManageBackupCodes navigation={navigation} />;
}

function Header({ navigation, title }: { navigation: any; title: string }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} activeOpacity={0.7}>
        <Text style={styles.backIcon}>←</Text>
      </TouchableOpacity>
      <Text style={styles.headerTitle}>{title}</Text>
    </View>
  );
}

function RedeemBackupCode({ navigation }: { navigation: any }) {
  const { verifyMfa, challenge, cancelMfa, setLockNotice } = useAuth();
  const { showToast } = useToast();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError('');
    if (code.replace(/[^A-Z0-9]/gi, '').length !== 10) {
      setError('Backup codes have 10 characters, e.g. ABCDE-FGH23');
      return;
    }
    setBusy(true);
    try {
      await verifyMfa({ backupCode: code });
      showToast('Backup code accepted — it cannot be used again', 'success');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'ACCOUNT_LOCKED') {
        setLockNotice({ email: challenge?.user.email, lockReason: e.details?.lock_reason, lockedUntil: e.details?.locked_until, message: e.message });
        cancelMfa();
        return;
      }
      if (e instanceof ApiError && e.code === 'MFA_EXPIRED') {
        cancelMfa();
        return;
      }
      setError(e instanceof ApiError ? e.message : 'Verification failed');
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <Header navigation={navigation} title="Use a backup code" />
        <Alert
          variant="warning"
          title="⚠️ Single use"
          description="Each backup code works only once. Generate a new set from Settings after signing in if you are running low."
          style={styles.section}
        />
        <Card style={styles.section}>
          <CardHeader>
            <CardTitle>Enter backup code</CardTitle>
          </CardHeader>
          <CardContent>
            <Text style={styles.inputLabel}>Signing in as {challenge?.user.email}</Text>
            <Input
              placeholder="ABCDE-FGH23"
              value={code}
              onChangeText={(text) => setCode(text.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 11))}
              autoCapitalize="characters"
              autoCorrect={false}
              inputStyle={styles.codeInput}
              onSubmitEditing={submit}
            />
            {error ? <Alert variant="destructive" description={error} style={styles.errorAlert} /> : null}
            <Button onPress={submit} disabled={busy || !code} style={styles.verifyButton}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.verifyButtonText}>Verify backup code</Text>}
            </Button>
          </CardContent>
        </Card>
        <Text style={styles.actionsDescription}>No codes left? Ask an administrator to reset your password.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function ManageBackupCodes({ navigation }: { navigation: any }) {
  const { mfa, refresh } = useAuth();
  const { notice } = useDialog();
  const { showToast } = useToast();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const regenerate = async () => {
    setError('');
    setBusy(true);
    try {
      const { data } = await authAPI.regenerateBackupCodes(password);
      setPassword('');
      await refresh();
      await notice({
        title: 'Your new backup codes',
        message: 'Store these somewhere safe (e.g. a password manager). They are shown only once, and your previous codes no longer work.',
        codes: data.backup_codes,
      });
      showToast('New backup codes generated', 'success');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not generate codes');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <Header navigation={navigation} title="Backup codes" />
        {!mfa.enabled ? (
          <Alert
            variant="default"
            title="Authenticator not enabled"
            description="Backup codes are created when you enable authenticator-app verification."
            style={styles.section}
          />
        ) : (
          <>
            <Card style={styles.section}>
              <CardContent style={styles.remaining}>
                <Text style={styles.remainingValue}>{mfa.backup_codes_remaining}</Text>
                <Text style={styles.remainingLabel}>unused backup codes remaining</Text>
              </CardContent>
            </Card>
            <Card style={styles.section}>
              <CardHeader>
                <CardTitle>Generate a new set</CardTitle>
              </CardHeader>
              <CardContent>
                <Text style={styles.inputLabel}>Confirm your password</Text>
                <Input value={password} onChangeText={setPassword} secureTextEntry placeholder="Current password" onSubmitEditing={regenerate} />
                {error ? <Alert variant="destructive" description={error} style={styles.errorAlert} /> : null}
                <Button onPress={regenerate} disabled={busy || !password} style={styles.verifyButton}>
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.verifyButtonText}>Generate new codes</Text>}
                </Button>
              </CardContent>
            </Card>
          </>
        )}
        {!mfa.enabled ? (
          <Button onPress={() => navigation.navigate('MultiFactorAuth')} style={styles.verifyButton}>
            <Text style={styles.verifyButtonText}>Set up authenticator app</Text>
          </Button>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  scrollView: { flex: 1 },
  scrollContent: { padding: 24, maxWidth: 520, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  backButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#f3f4f6', justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  backIcon: { fontSize: 24, color: '#1f2937' },
  headerTitle: { fontSize: 24, fontWeight: '600', color: '#1f2937' },
  section: { marginBottom: 20 },
  inputLabel: { fontSize: 14, color: '#6b7280', marginBottom: 8 },
  codeInput: { fontSize: 20, letterSpacing: 2, textAlign: 'center', fontFamily: 'monospace' },
  errorAlert: { marginBottom: 12 },
  verifyButton: { marginTop: 4, paddingVertical: 12 },
  verifyButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  actionsDescription: { fontSize: 13, color: '#6b7280', textAlign: 'center' },
  remaining: { alignItems: 'center', paddingVertical: 20 },
  remainingValue: { fontSize: 40, fontWeight: '700', color: '#1f2937' },
  remainingLabel: { fontSize: 14, color: '#6b7280' },
});
