import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Card, CardContent } from './ui/card.native';
import { Button } from './ui/button.native';
import { Alert } from './ui/alert.native';
import { useToast } from './ui/toast.native';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../services/api';

interface OTPVerificationScreenNewProps {
  navigation: any;
}

/**
 * Second sign-in step for accounts with MFA enabled: a 6-digit TOTP code from the staff
 * member's authenticator app (Google Authenticator, Microsoft Authenticator, Authy, ...).
 */
export function OTPVerificationScreenNew({ navigation }: OTPVerificationScreenNewProps) {
  const { challenge, verifyMfa, cancelMfa, setLockNotice } = useAuth();
  const { showToast } = useToast();
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(300);
  const inputRefs = useRef<(TextInput | null)[]>([]);

  useEffect(() => {
    const timer = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleSubmit = async (code?: string) => {
    const value = code ?? otp.join('');
    setError('');
    if (!/^\d{6}$/.test(value)) {
      setError('Please enter the 6-digit code');
      return;
    }
    setIsVerifying(true);
    try {
      await verifyMfa({ code: value });
      showToast('Verified — signed in securely', 'success');
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
      const remaining = e instanceof ApiError ? e.details?.attempts_remaining : undefined;
      setError(
        e instanceof ApiError
          ? `${e.message}${remaining !== undefined ? ` — ${remaining} attempt${remaining === 1 ? '' : 's'} left` : ''}`
          : 'Verification failed',
      );
      setOtp(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    } finally {
      setIsVerifying(false);
    }
  };

  const handleOtpChange = (raw: string, index: number) => {
    const digits = raw.replace(/\D/g, '');
    const next = [...otp];
    if (digits.length > 1) {
      // Pasted code: spread across the boxes.
      digits.split('').slice(0, 6 - index).forEach((digit, offset) => (next[index + offset] = digit));
    } else {
      next[index] = digits;
    }
    setOtp(next);
    setError('');
    const filled = next.findIndex((digit) => !digit);
    if (digits && filled !== -1) inputRefs.current[filled]?.focus();
    if (next.every(Boolean)) void handleSubmit(next.join(''));
  };

  const handleKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = String(secondsLeft % 60).padStart(2, '0');

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={cancelMfa} activeOpacity={0.7}>
            <Text style={styles.backButtonText}>←</Text>
          </TouchableOpacity>
          <View style={styles.headerTextContainer}>
            <Text style={styles.headerTitle}>Two-step verification</Text>
            <Text style={styles.headerSubtitle}>Signing in as {challenge?.user.name ?? 'staff member'}</Text>
          </View>
        </View>

        <Card style={styles.methodInfoCard}>
          <LinearGradient colors={['#10b981', '#059669']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.methodInfoGradient}>
            <CardContent style={styles.methodInfoContent}>
              <View style={styles.methodIconContainer}>
                <Text style={styles.methodIcon}>🛡️</Text>
              </View>
              <View style={styles.methodTextContainer}>
                <Text style={styles.methodDestination}>Authenticator app</Text>
                <Text style={styles.methodDescription}>Enter the 6-digit code shown for NeuroLock ({challenge?.user.email})</Text>
              </View>
            </CardContent>
          </LinearGradient>
        </Card>

        <View style={styles.otpContainer}>
          <Text style={styles.otpLabel}>Verification code</Text>
          <View style={styles.otpInputRow}>
            {otp.map((digit, index) => (
              <TextInput
                key={index}
                ref={(ref) => {
                  inputRefs.current[index] = ref;
                }}
                style={[styles.otpInput, digit ? styles.otpInputFilled : null]}
                value={digit}
                onChangeText={(value) => handleOtpChange(value, index)}
                onKeyPress={(e) => handleKeyPress(e, index)}
                keyboardType="number-pad"
                maxLength={index === 0 ? 6 : 1}
                selectTextOnFocus
                autoFocus={index === 0}
                editable={!isVerifying}
                accessibilityLabel={`Digit ${index + 1}`}
              />
            ))}
          </View>
        </View>

        {error ? <Alert variant="destructive" description={error} style={styles.errorAlert} /> : null}

        <Button onPress={() => handleSubmit()} disabled={isVerifying || otp.some((digit) => !digit)} style={styles.verifyButton}>
          {isVerifying ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.verifyButtonText}>Verify Code</Text>}
        </Button>

        <Text style={styles.timerText}>
          {secondsLeft > 0 ? `This sign-in attempt expires in ${minutes}:${seconds}` : 'This sign-in attempt has expired — go back and sign in again.'}
        </Text>

        <View style={styles.alternativeContainer}>
          <TouchableOpacity onPress={() => navigation.navigate('BackupCodesNew', { mode: 'login' })} activeOpacity={0.7}>
            <Text style={styles.alternativeLink}>Use a backup code instead</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('MFASelectionNew')} activeOpacity={0.7}>
            <Text style={styles.alternativeText}>Other verification options</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  scrollView: { flex: 1 },
  scrollContent: { padding: 24, maxWidth: 520, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  backButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#f3f4f6', justifyContent: 'center', alignItems: 'center' },
  backButtonText: { fontSize: 24, color: '#1f2937' },
  headerTextContainer: { marginLeft: 16, flex: 1 },
  headerTitle: { fontSize: 24, fontWeight: '600', color: '#1f2937' },
  headerSubtitle: { fontSize: 14, color: '#6b7280', marginTop: 4 },
  methodInfoCard: { marginBottom: 32, borderRadius: 12, overflow: 'hidden' },
  methodInfoGradient: { borderRadius: 12 },
  methodInfoContent: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  methodIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  methodIcon: { fontSize: 28 },
  methodTextContainer: { flex: 1 },
  methodDestination: { fontSize: 16, fontWeight: '600', color: '#ffffff', marginBottom: 4 },
  methodDescription: { fontSize: 12, color: '#ecfdf5' },
  otpContainer: { marginBottom: 24 },
  otpLabel: { fontSize: 16, fontWeight: '600', color: '#1f2937', marginBottom: 12 },
  otpInputRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  otpInput: {
    flex: 1,
    maxWidth: 52,
    height: 56,
    borderWidth: 2,
    borderColor: '#d1d5db',
    borderRadius: 8,
    fontSize: 24,
    fontWeight: '600',
    textAlign: 'center',
    color: '#1f2937',
  },
  otpInputFilled: { borderColor: '#3b82f6', backgroundColor: '#eff6ff' },
  errorAlert: { marginBottom: 24 },
  verifyButton: { marginBottom: 16, paddingVertical: 14 },
  verifyButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  timerText: { fontSize: 13, color: '#6b7280', textAlign: 'center', marginBottom: 24 },
  alternativeContainer: { alignItems: 'center', gap: 14, marginBottom: 24 },
  alternativeLink: { fontSize: 16, color: '#3b82f6', fontWeight: '500' },
  alternativeText: { fontSize: 14, color: '#6b7280' },
});
