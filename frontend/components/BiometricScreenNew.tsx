import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from './ui/button.native';
import { Alert } from './ui/alert.native';
import { useAuth } from '../context/AuthContext';

interface BiometricScreenNewProps {
  navigation: any;
}

/**
 * Biometric quick unlock. Shown on start-up when this device has a saved session and the user
 * enabled biometric unlock in Settings. The fingerprint/face check unlocks the locally stored
 * session token; the server still validates that session before any data is shown.
 */
export function BiometricScreenNew({ navigation }: BiometricScreenNewProps) {
  const { unlockWithBiometrics, logout } = useAuth();
  const [status, setStatus] = useState<'waiting' | 'scanning' | 'failed'>('waiting');
  const [error, setError] = useState('');
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (status !== 'scanning') return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.15, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [status, pulse]);

  const scan = async () => {
    setStatus('scanning');
    setError('');
    try {
      const ok = await unlockWithBiometrics();
      if (!ok) {
        setStatus('failed');
        setError('Biometric verification was not completed. Try again or sign in with your password.');
      }
    } catch {
      setStatus('failed');
      setError('Biometric verification is unavailable on this device.');
    }
  };

  useEffect(() => {
    void scan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const color = status === 'failed' ? '#ef4444' : status === 'scanning' ? '#3b82f6' : '#9ca3af';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.headerTitle}>Unlock NeuroLock</Text>
        <Text style={styles.headerSubtitle}>Your session is locked on this device</Text>

        <View style={styles.biometricContainer}>
          <Animated.View style={[styles.biometricCircle, { borderColor: color, transform: [{ scale: pulse }] }]}>
            <Text style={[styles.biometricIcon, { color }]}>{status === 'failed' ? '✗' : '👆'}</Text>
          </Animated.View>
          <Text style={styles.statusTitle}>{status === 'scanning' ? 'Verifying…' : status === 'failed' ? 'Not verified' : 'Touch the sensor'}</Text>
          <Text style={styles.statusDescription}>Use your fingerprint, face or device passcode</Text>
          {status !== 'scanning' ? (
            <Button onPress={scan} style={styles.actionButton}>
              <Text style={styles.actionButtonText}>{status === 'failed' ? 'Try again' : 'Unlock'}</Text>
            </Button>
          ) : null}
          {error ? <Alert variant="destructive" description={error} style={styles.errorAlert} /> : null}
        </View>

        <Button variant="outline" onPress={() => logout()} style={styles.fallbackButton}>
          <Text style={styles.fallbackButtonText}>Sign in with password instead</Text>
        </Button>
        <TouchableOpacity onPress={() => navigation.navigate('HelpNew')} style={styles.helpButton}>
          <Text style={styles.helpButtonText}>Having trouble with biometrics?</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  scrollContent: { padding: 24, alignItems: 'stretch', maxWidth: 480, width: '100%', alignSelf: 'center' },
  headerTitle: { fontSize: 26, fontWeight: '700', color: '#1f2937', textAlign: 'center', marginTop: 24 },
  headerSubtitle: { fontSize: 14, color: '#6b7280', textAlign: 'center', marginTop: 6 },
  biometricContainer: { alignItems: 'center', marginVertical: 40 },
  biometricCircle: { width: 160, height: 160, borderRadius: 80, borderWidth: 4, justifyContent: 'center', alignItems: 'center', marginBottom: 24 },
  biometricIcon: { fontSize: 64 },
  statusTitle: { fontSize: 20, fontWeight: '600', color: '#1f2937', marginBottom: 6 },
  statusDescription: { fontSize: 14, color: '#6b7280', textAlign: 'center', marginBottom: 24 },
  actionButton: { width: '100%', paddingVertical: 14 },
  actionButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  errorAlert: { marginTop: 16, width: '100%' },
  fallbackButton: { paddingVertical: 14 },
  fallbackButtonText: { color: '#1f2937', fontSize: 15, fontWeight: '500' },
  helpButton: { alignItems: 'center', paddingVertical: 16 },
  helpButtonText: { fontSize: 14, color: '#6b7280' },
});
