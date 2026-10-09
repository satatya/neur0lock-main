import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card.native';
import { Button } from './ui/button.native';
import { Input } from './ui/input.native';
import { Alert } from './ui/alert.native';
import { useToast } from './ui';
import { ApiError, authAPI } from '../services/api';

type StepType = 'request' | 'reset' | 'done';

/**
 * Password reset without an e-mail gateway: the request is recorded, an administrator verifies
 * the person and issues a one-time 8-character code (valid 30 minutes), which is entered here.
 */
export default function ForgotPasswordScreenNew() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { showToast } = useToast();
  const [step, setStep] = useState<StepType>('request');
  const [email, setEmail] = useState<string>(route.params?.email ?? '');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleResetRequest = async () => {
    setError('');
    if (email.trim().length < 3) {
      setError('Enter the username or email of your account');
      return;
    }
    setIsLoading(true);
    try {
      await authAPI.requestPasswordReset(email.trim().toLowerCase());
      setStep('reset');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not submit the request');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordReset = async () => {
    setError('');
    if (!code.trim() || !newPassword || !confirmPassword) {
      setError('Please fill in all fields');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      setError('Password must be at least 8 characters and contain a letter and a number');
      return;
    }
    setIsLoading(true);
    try {
      await authAPI.confirmPasswordReset(email.trim().toLowerCase(), code.trim(), newPassword);
      showToast('Password updated — you can sign in now', 'success');
      setStep('done');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reset the password');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.navigate('LoginNew')} style={styles.backButton}>
            <Text style={styles.backButtonText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Reset Password</Text>
        </View>

        {step === 'request' ? (
          <>
            <Alert
              variant="default"
              title="How resets work"
              description="Enter your username or email. An administrator verifies your identity and gives you a one-time reset code (valid for 30 minutes). Already have a code? Skip ahead."
              style={styles.section}
            />
            <Card style={styles.section}>
              <CardHeader>
                <CardTitle>1. Request a reset</CardTitle>
              </CardHeader>
              <CardContent>
                <Input
                  label="Username or email"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@neurolock.com"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  editable={!isLoading}
                />
                {error ? <Alert variant="destructive" description={error} style={styles.errorAlert} /> : null}
                <Button onPress={handleResetRequest} disabled={isLoading} loading={isLoading}>
                  Submit request
                </Button>
                <TouchableOpacity onPress={() => setStep('reset')} style={styles.linkButton}>
                  <Text style={styles.linkText}>I already have a reset code →</Text>
                </TouchableOpacity>
              </CardContent>
            </Card>
          </>
        ) : null}

        {step === 'reset' ? (
          <Card style={styles.section}>
            <CardHeader>
              <CardTitle>2. Choose a new password</CardTitle>
            </CardHeader>
            <CardContent>
              <Text style={styles.body}>
                Enter the reset code from your administrator.
                {__DEV__ ? ' (Development: the code is also printed in the API server console.)' : ''}
              </Text>
              <Input label="Username or email" value={email} onChangeText={setEmail} autoCapitalize="none" editable={!isLoading} />
              <Input
                label="Reset code"
                value={code}
                onChangeText={(text) => setCode(text.toUpperCase())}
                placeholder="ABCD-EF23"
                autoCapitalize="characters"
                editable={!isLoading}
              />
              <Input label="New password" value={newPassword} onChangeText={setNewPassword} secureTextEntry editable={!isLoading} />
              <Input label="Confirm new password" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry editable={!isLoading} />
              <Text style={styles.hint}>At least 8 characters, including a letter and a number.</Text>
              {error ? <Alert variant="destructive" description={error} style={styles.errorAlert} /> : null}
              <Button onPress={handlePasswordReset} disabled={isLoading} loading={isLoading}>
                Reset password
              </Button>
              <TouchableOpacity onPress={() => setStep('request')} style={styles.linkButton}>
                <Text style={styles.linkText}>← Request a code</Text>
              </TouchableOpacity>
            </CardContent>
          </Card>
        ) : null}

        {step === 'done' ? (
          <Card style={styles.section}>
            <CardContent style={styles.done}>
              <Text style={styles.doneIcon}>✅</Text>
              <Text style={styles.doneTitle}>Password updated</Text>
              <Text style={styles.body}>All other sessions for your account were signed out.</Text>
              <Button onPress={() => navigation.navigate('LoginNew')}>Back to sign in</Button>
            </CardContent>
          </Card>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  scrollContent: { padding: 16, maxWidth: 520, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  backButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#f3f4f6', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  backButtonText: { fontSize: 24, color: '#1f2937' },
  headerTitle: { fontSize: 22, fontWeight: '600', color: '#111827' },
  section: { marginBottom: 16 },
  body: { fontSize: 14, color: '#4b5563', lineHeight: 20, marginBottom: 12 },
  hint: { fontSize: 12, color: '#6b7280', marginBottom: 12 },
  errorAlert: { marginBottom: 12 },
  linkButton: { alignItems: 'center', paddingTop: 16 },
  linkText: { color: '#3b82f6', fontSize: 14, fontWeight: '500' },
  done: { alignItems: 'center', paddingVertical: 24 },
  doneIcon: { fontSize: 40, marginBottom: 8 },
  doneTitle: { fontSize: 20, fontWeight: '600', color: '#111827', marginBottom: 8 },
});
