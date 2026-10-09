import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card.native';
import { Button } from './ui/button.native';
import { Input } from './ui/input.native';
import { Alert } from './ui/alert.native';
import { useAuth } from '../context/AuthContext';
import { ApiError, authAPI, setStepUpToken } from '../services/api';

interface ReAuthenticationPromptNewProps {
  route?: {
    params?: {
      reason?: string;
      /** Screen to open after successful verification, with its params. */
      next?: { screen: string; params?: Record<string, unknown> };
    };
  };
}

type AuthMethod = 'password' | 'otp';

/**
 * Full-screen step-up verification. Obtains a short-lived (10 minute) re-authentication token
 * from the API that sensitive endpoints (therapy notes, role changes, resets) require.
 */
export default function ReAuthenticationPromptNew({ route }: ReAuthenticationPromptNewProps) {
  const navigation = useNavigation<any>();
  const { user, mfa, logout } = useAuth();
  const reason = route?.params?.reason ?? 'This area contains sensitive patient information.';
  const [method, setMethod] = useState<AuthMethod>('password');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      const { data } = await authAPI.stepUp(method === 'password' ? { password: secret } : { code: secret });
      setStepUpToken(data.step_up_token, data.expires_at);
      const next = route?.params?.next;
      if (next) navigation.replace(next.screen, next.params);
      else navigation.goBack();
    } catch (e) {
      if (e instanceof ApiError && e.status === 423) {
        await logout('locked');
        return;
      }
      const remaining = e instanceof ApiError ? e.details?.attempts_remaining : undefined;
      setError(e instanceof ApiError ? `${e.message}${remaining !== undefined ? ` (${remaining} attempts left)` : ''}` : 'Verification failed');
      setSecret('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} disabled={busy}>
            <Text style={styles.backButtonText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Re-Authentication Required</Text>
        </View>

        <Alert variant="default" title="🛡️ Security check" description={reason} style={styles.section} />

        <Card style={styles.section}>
          <CardContent>
            <Text style={styles.contextLabel}>Signed in as</Text>
            <Text style={styles.contextValue}>
              {user?.name} · {user?.role_name}
            </Text>
          </CardContent>
        </Card>

        {mfa.enabled ? (
          <View style={styles.methodButtons}>
            {(['password', 'otp'] as const).map((option) => (
              <TouchableOpacity
                key={option}
                style={[styles.methodButton, method === option && styles.methodButtonActive]}
                onPress={() => {
                  setMethod(option);
                  setSecret('');
                  setError('');
                }}
                disabled={busy}
              >
                <Text style={styles.methodIcon}>{option === 'password' ? '🔒' : '📲'}</Text>
                <Text style={[styles.methodButtonText, method === option && styles.methodButtonTextActive]}>
                  {option === 'password' ? 'Password' : 'Authenticator code'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>{method === 'password' ? 'Enter your password' : 'Enter your 6-digit code'}</CardTitle>
          </CardHeader>
          <CardContent>
            <Input
              value={secret}
              onChangeText={(text) => setSecret(method === 'otp' ? text.replace(/\D/g, '').slice(0, 6) : text)}
              placeholder={method === 'password' ? 'Password' : '000000'}
              secureTextEntry={method === 'password'}
              keyboardType={method === 'otp' ? 'number-pad' : 'default'}
              editable={!busy}
              autoFocus
              onSubmitEditing={submit}
            />
            {error ? <Alert variant="destructive" description={error} style={styles.errorAlert} /> : null}
            <Button onPress={submit} disabled={busy || !secret || (method === 'otp' && secret.length !== 6)} style={styles.button}>
              {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.buttonText}>Verify</Text>}
            </Button>
          </CardContent>
        </Card>

        <View style={styles.timeoutNotice}>
          <Text style={styles.warningIcon}>⏱️</Text>
          <Text style={styles.timeoutText}>Verification remains valid for 10 minutes. Failed attempts count towards account lockout.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  content: { padding: 16, maxWidth: 520, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  backButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#f3f4f6', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  backButtonText: { fontSize: 24, color: '#1f2937' },
  headerTitle: { fontSize: 20, fontWeight: '600', color: '#111827', flex: 1 },
  section: { marginBottom: 16 },
  contextLabel: { fontSize: 12, color: '#6b7280' },
  contextValue: { fontSize: 16, fontWeight: '600', color: '#111827', marginTop: 2 },
  methodButtons: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  methodButton: { flex: 1, padding: 14, borderRadius: 10, borderWidth: 2, borderColor: '#e5e7eb', backgroundColor: '#fff', alignItems: 'center', gap: 6 },
  methodButtonActive: { borderColor: '#3b82f6', backgroundColor: '#eff6ff' },
  methodIcon: { fontSize: 22 },
  methodButtonText: { fontSize: 13, color: '#4b5563', fontWeight: '500' },
  methodButtonTextActive: { color: '#1d4ed8' },
  errorAlert: { marginBottom: 12 },
  button: { paddingVertical: 12 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  timeoutNotice: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20, paddingHorizontal: 4 },
  warningIcon: { fontSize: 16 },
  timeoutText: { fontSize: 12, color: '#6b7280', flex: 1 },
});
