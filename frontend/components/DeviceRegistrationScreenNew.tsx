import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card.native';
import { Button } from './ui/button.native';
import { Badge } from './ui/badge.native';
import { Alert } from './ui/alert.native';
import { useToast } from './ui';
import { useStepUp } from '../context/StepUpContext';
import { Device, deviceAPI } from '../services/api';
import { Field, OptionPicker } from './common/forms';
import { useErrorToast } from './common/hooks';

type StepType = 'verify' | 'device' | 'submitted';

const DEVICE_TYPES = ['Smartphone', 'Tablet', 'Desktop/Laptop', 'Workstation'] as const;

/**
 * Register a new device: re-verify identity, describe the device and justify it,
 * then an administrator approves or rejects the request from the Security centre.
 */
export default function DeviceRegistrationScreenNew() {
  const navigation = useNavigation<any>();
  const { ensureStepUp, withStepUp } = useStepUp();
  const { showToast } = useToast();
  const showError = useErrorToast();
  const [step, setStep] = useState<StepType>('verify');
  const [deviceType, setDeviceType] = useState<(typeof DEVICE_TYPES)[number] | ''>(Platform.OS === 'web' ? 'Desktop/Laptop' : 'Smartphone');
  const [deviceName, setDeviceName] = useState('');
  const [justification, setJustification] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [device, setDevice] = useState<Device | null>(null);
  const [error, setError] = useState('');

  const verify = async () => {
    if (await ensureStepUp('Registering a new device requires you to confirm your identity.')) setStep('device');
  };

  const submit = async () => {
    setError('');
    if (!deviceType || !deviceName.trim()) return setError('Enter a device name and type');
    if (justification.trim().length < 10) return setError('Please give a short justification (at least 10 characters)');
    setSubmitting(true);
    try {
      const { data } = await withStepUp(() =>
        deviceAPI.register({ device_name: deviceName.trim(), device_type: deviceType, platform: Platform.OS, justification: justification.trim() }),
      );
      setDevice(data);
      setStep('submitted');
      showToast('Device submitted for approval', 'success');
    } catch (e) {
      showError(e);
    } finally {
      setSubmitting(false);
    }
  };

  const steps: { key: StepType; label: string }[] = [
    { key: 'verify', label: 'Verify' },
    { key: 'device', label: 'Device' },
    { key: 'submitted', label: 'Approval' },
  ];
  const currentIndex = steps.findIndex((s) => s.key === step);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Text style={styles.backButtonText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Add New Device</Text>
        </View>

        <View style={styles.stepper}>
          {steps.map((s, index) => (
            <View key={s.key} style={styles.stepItem}>
              <View style={[styles.stepDot, index <= currentIndex && styles.stepDotActive]}>
                <Text style={[styles.stepNumber, index <= currentIndex && styles.stepNumberActive]}>{index < currentIndex ? '✓' : index + 1}</Text>
              </View>
              <Text style={styles.stepLabel}>{s.label}</Text>
            </View>
          ))}
        </View>

        {step === 'verify' ? (
          <Card style={styles.card}>
            <CardHeader>
              <CardTitle>Step 1: Confirm your identity</CardTitle>
            </CardHeader>
            <CardContent>
              <Text style={styles.description}>Re-enter your password (or authenticator code) before registering a device that can access patient records.</Text>
              <Button onPress={verify} style={styles.button}>
                Verify identity
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {step === 'device' ? (
          <Card style={styles.card}>
            <CardHeader>
              <CardTitle>Step 2: Device details</CardTitle>
            </CardHeader>
            <CardContent>
              <OptionPicker label="Device type" options={DEVICE_TYPES} value={deviceType} onChange={setDeviceType} required />
              <Field label="Device name" required value={deviceName} onChangeText={setDeviceName} placeholder="e.g. Ward A nursing tablet" maxLength={100} />
              <Field
                label="Justification"
                required
                value={justification}
                onChangeText={setJustification}
                multiline
                maxLength={255}
                placeholder="Why this device needs access (e.g. bedside medication charting on Ward A)"
              />
              {error ? <Alert variant="destructive" description={error} style={styles.errorAlert} /> : null}
              <Button onPress={submit} loading={submitting} disabled={submitting} style={styles.button}>
                Submit for approval
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {step === 'submitted' && device ? (
          <Card style={styles.card}>
            <CardContent style={styles.submitted}>
              <Text style={styles.submittedIcon}>{device.device_type === 'Desktop/Laptop' || device.device_type === 'Workstation' ? '💻' : '📱'}</Text>
              <Text style={styles.submittedTitle}>{device.device_name}</Text>
              <Badge variant="warning">Pending administrator approval</Badge>
              <Text style={styles.description}>
                An administrator has been notified in the Security centre. You can follow the status under Settings → Devices.
              </Text>
              <Button onPress={() => navigation.goBack()} style={styles.button}>
                Done
              </Button>
            </CardContent>
          </Card>
        ) : null}

        <Alert
          variant="default"
          title="🛡️ Device policy"
          description="Only approved devices may be marked as trusted (max 5). Removing a device revokes it; administrators can sign an account out of all devices."
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  content: { padding: 16, paddingBottom: 40, maxWidth: 600, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  backButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#f3f4f6', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  backButtonText: { fontSize: 24, color: '#1f2937' },
  headerTitle: { fontSize: 22, fontWeight: '600', color: '#111827' },
  stepper: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 20 },
  stepItem: { alignItems: 'center', gap: 6 },
  stepDot: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#e5e7eb', alignItems: 'center', justifyContent: 'center' },
  stepDotActive: { backgroundColor: '#3b82f6' },
  stepNumber: { color: '#6b7280', fontWeight: '700' },
  stepNumberActive: { color: '#fff' },
  stepLabel: { fontSize: 12, color: '#4b5563' },
  card: { marginBottom: 16 },
  description: { fontSize: 14, color: '#4b5563', lineHeight: 20, marginVertical: 12, textAlign: 'left' },
  button: { paddingVertical: 12, marginTop: 4 },
  errorAlert: { marginBottom: 12 },
  submitted: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  submittedIcon: { fontSize: 44 },
  submittedTitle: { fontSize: 18, fontWeight: '600', color: '#111827' },
});
