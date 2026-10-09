import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card.native';
import { Button } from './ui/button.native';
import { Input } from './ui/input.native';
import { Badge } from './ui/badge.native';
import { Alert } from './ui/alert.native';
import { useToast } from './ui';
import { authAPI } from '../services/api';
import { formatDateTime } from './common/format';

interface AccountLockedScreenNewProps {
  route?: {
    params?: {
      email?: string;
      lockReason?: 'failed-attempts' | 'admin-lock' | string;
      lockedUntil?: string | null;
      message?: string;
    };
  };
}

/** Shown when the API reports the account as locked (after failed attempts or by an administrator). */
export default function AccountLockedScreenNew({ route }: AccountLockedScreenNewProps) {
  const navigation = useNavigation<any>();
  const { showToast } = useToast();
  const email = route?.params?.email ?? '';
  const lockReason = route?.params?.lockReason ?? 'failed-attempts';
  const lockedUntil = route?.params?.lockedUntil ?? null;
  const [now, setNow] = useState(Date.now());
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const remainingMs = lockedUntil ? new Date(lockedUntil).getTime() - now : 0;
  const temporary = lockReason === 'failed-attempts' && Boolean(lockedUntil);
  const expired = temporary && remainingMs <= 0;
  const minutes = Math.floor(Math.max(remainingMs, 0) / 60_000);
  const seconds = String(Math.floor((Math.max(remainingMs, 0) % 60_000) / 1000)).padStart(2, '0');

  const requestUnlock = async () => {
    if (!email) return;
    setSending(true);
    try {
      await authAPI.requestUnlock(email, note.trim() || undefined);
      setSent(true);
      showToast('Unlock request sent to administrators', 'success');
    } catch (e: any) {
      showToast(e?.message ?? 'Could not send request', 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.navigate('WelcomeNew')} style={styles.backButton}>
            <Text style={styles.backButtonText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Account Locked</Text>
        </View>

        <Alert
          variant="destructive"
          title="🔒 Sign-in blocked"
          description={route?.params?.message ?? 'This account is locked.'}
          style={styles.section}
        />

        <Card style={styles.section}>
          <CardHeader>
            <CardTitle>Lock details</CardTitle>
          </CardHeader>
          <CardContent>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Account</Text>
              <Text style={styles.infoValue}>{email || '—'}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Lock type</Text>
              <Badge variant={temporary ? 'warning' : 'destructive'}>{temporary ? 'Automatic (failed attempts)' : 'Administrative'}</Badge>
            </View>
            {temporary ? (
              <>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Unlocks at</Text>
                  <Text style={styles.infoValue}>{formatDateTime(lockedUntil)}</Text>
                </View>
                <View style={styles.countdown}>
                  <Text style={styles.countdownValue}>{expired ? 'Unlocked' : `${minutes}:${seconds}`}</Text>
                  <Text style={styles.countdownLabel}>{expired ? 'You can try signing in again' : 'until you can try again'}</Text>
                </View>
              </>
            ) : (
              <Text style={styles.body}>An administrator must unlock this account before you can sign in.</Text>
            )}
          </CardContent>
        </Card>

        {expired ? (
          <Button onPress={() => navigation.navigate('LoginNew')} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Back to sign in</Text>
          </Button>
        ) : (
          <Card style={styles.section}>
            <CardHeader>
              <CardTitle>Ask an administrator</CardTitle>
            </CardHeader>
            <CardContent>
              {sent ? (
                <Text style={styles.body}>✅ Your request was sent. An administrator can unlock your account from the Staff tab.</Text>
              ) : (
                <>
                  <Text style={styles.body}>Administrators are notified in their Security centre.</Text>
                  <Input value={note} onChangeText={setNote} placeholder="Optional message (e.g. ward, urgency)" maxLength={300} />
                  <Button onPress={requestUnlock} disabled={sending || !email} loading={sending}>
                    Request unlock
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        )}

        <Card style={styles.section}>
          <CardContent>
            <Text style={styles.tipTitle}>Why was I locked out?</Text>
            <Text style={styles.body}>
              After 5 incorrect passwords or verification codes the account is locked for 15 minutes to stop password-guessing attacks.
              If you did not make these attempts, tell your administrator — the attempts are recorded in the audit log.
            </Text>
          </CardContent>
        </Card>

        <TouchableOpacity onPress={() => navigation.navigate('ForgotPasswordNew', { email })} style={styles.linkButton}>
          <Text style={styles.linkText}>Forgot your password?</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  scrollContent: { padding: 16, maxWidth: 560, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  backButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#f3f4f6', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  backButtonText: { fontSize: 24, color: '#1f2937' },
  headerTitle: { fontSize: 22, fontWeight: '600', color: '#111827' },
  section: { marginBottom: 16 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  infoLabel: { fontSize: 13, color: '#6b7280' },
  infoValue: { fontSize: 14, color: '#111827', fontWeight: '500' },
  countdown: { alignItems: 'center', paddingVertical: 16 },
  countdownValue: { fontSize: 36, fontWeight: '700', color: '#dc2626' },
  countdownLabel: { fontSize: 13, color: '#6b7280' },
  body: { fontSize: 14, color: '#4b5563', lineHeight: 20, marginBottom: 12 },
  tipTitle: { fontSize: 15, fontWeight: '600', color: '#111827', marginBottom: 6 },
  primaryButton: { paddingVertical: 14, marginBottom: 16 },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  linkButton: { alignItems: 'center', paddingVertical: 16 },
  linkText: { color: '#3b82f6', fontSize: 14, fontWeight: '500' },
});
