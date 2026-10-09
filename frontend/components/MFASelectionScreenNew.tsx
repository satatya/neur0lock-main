import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Card, CardContent } from './ui/card.native';
import { Badge } from './ui/badge.native';
import { Alert } from './ui/alert.native';
import { useAuth } from '../context/AuthContext';

interface MFASelectionScreenNewProps {
  navigation: any;
}

interface MFAOption {
  id: string;
  title: string;
  description: string;
  icon: string;
  available: boolean;
  unavailableReason?: string;
  colors: [string, string];
  screen?: string;
  params?: Record<string, unknown>;
}

/** Verification method chooser during sign-in (second factor). */
export function MFASelectionScreenNew({ navigation }: MFASelectionScreenNewProps) {
  const { challenge, cancelMfa } = useAuth();

  const options: MFAOption[] = [
    {
      id: 'authenticator',
      title: 'Authenticator App',
      description: 'Enter the 6-digit code from your authenticator app',
      icon: '🛡️',
      available: true,
      colors: ['#10b981', '#059669'],
      screen: 'OTPVerificationNew',
    },
    {
      id: 'backup',
      title: 'Backup Code',
      description: 'Use one of your single-use recovery codes',
      icon: '🔑',
      available: true,
      colors: ['#f59e0b', '#d97706'],
      screen: 'BackupCodesNew',
      params: { mode: 'login' },
    },
    {
      id: 'sms',
      title: 'SMS Verification',
      description: 'Receive a code via text message',
      icon: '📱',
      available: false,
      unavailableReason: 'No SMS gateway configured',
      colors: ['#3b82f6', '#2563eb'],
    },
    {
      id: 'email',
      title: 'Email Verification',
      description: 'Receive a code via email',
      icon: '✉️',
      available: false,
      unavailableReason: 'No email gateway configured',
      colors: ['#a855f7', '#9333ea'],
    },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()} activeOpacity={0.7}>
            <Text style={styles.backButtonText}>←</Text>
          </TouchableOpacity>
          <View style={styles.headerTextContainer}>
            <Text style={styles.headerTitle}>Verification options</Text>
            <Text style={styles.headerSubtitle}>Additional security layer required</Text>
          </View>
        </View>

        <Card style={styles.userInfoCard}>
          <LinearGradient colors={['#3b82f6', '#2563eb']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.userInfoGradient}>
            <CardContent style={styles.userInfoContent}>
              <View>
                <Text style={styles.userInfoLabel}>Password verified for</Text>
                <Text style={styles.userInfoValue}>{challenge?.user.email ?? '—'}</Text>
              </View>
              <Text style={styles.lockIcon}>🔒</Text>
            </CardContent>
          </LinearGradient>
        </Card>

        <View style={styles.optionsContainer}>
          {options.map((option) => (
            <TouchableOpacity
              key={option.id}
              style={[styles.optionCard, !option.available && styles.optionCardDisabled]}
              onPress={() => option.screen && navigation.navigate(option.screen, option.params)}
              disabled={!option.available}
              activeOpacity={0.7}
            >
              <Card style={styles.optionCardInner}>
                <CardContent style={styles.optionCardContent}>
                  <LinearGradient colors={option.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.optionIconContainer}>
                    <Text style={styles.optionIcon}>{option.icon}</Text>
                  </LinearGradient>
                  <View style={styles.optionTextContainer}>
                    <View style={styles.optionTitleRow}>
                      <Text style={styles.optionTitle}>{option.title}</Text>
                      {!option.available ? <Badge variant="outline">Unavailable</Badge> : null}
                    </View>
                    <Text style={styles.optionDescription}>{option.available ? option.description : option.unavailableReason}</Text>
                  </View>
                  {option.available ? <Text style={styles.chevronIcon}>›</Text> : null}
                </CardContent>
              </Card>
            </TouchableOpacity>
          ))}
        </View>

        <Alert
          variant="default"
          title="Lost access to your authenticator?"
          description="Use a backup code, or ask an administrator to reset your password; MFA can then be re-enrolled from Settings."
        />

        <TouchableOpacity style={styles.cancelButton} onPress={cancelMfa} activeOpacity={0.7}>
          <Text style={styles.cancelText}>Cancel sign-in</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  scrollView: { flex: 1 },
  scrollContent: { padding: 24, maxWidth: 560, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  backButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#f3f4f6', justifyContent: 'center', alignItems: 'center' },
  backButtonText: { fontSize: 24, color: '#1f2937' },
  headerTextContainer: { marginLeft: 16, flex: 1 },
  headerTitle: { fontSize: 24, fontWeight: '600', color: '#1f2937' },
  headerSubtitle: { fontSize: 14, color: '#6b7280', marginTop: 4 },
  userInfoCard: { marginBottom: 24, borderRadius: 12, overflow: 'hidden' },
  userInfoGradient: { borderRadius: 12 },
  userInfoContent: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  userInfoLabel: { fontSize: 12, color: '#e0f2fe', marginBottom: 4 },
  userInfoValue: { fontSize: 16, fontWeight: '600', color: '#ffffff' },
  lockIcon: { fontSize: 20 },
  optionsContainer: { marginBottom: 16 },
  optionCard: { marginBottom: 12 },
  optionCardDisabled: { opacity: 0.5 },
  optionCardInner: { borderWidth: 2, borderColor: '#e5e7eb', borderRadius: 12 },
  optionCardContent: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  optionIconContainer: { width: 56, height: 56, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  optionIcon: { fontSize: 28 },
  optionTextContainer: { flex: 1 },
  optionTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4, gap: 8 },
  optionTitle: { fontSize: 16, fontWeight: '600', color: '#1f2937' },
  optionDescription: { fontSize: 14, color: '#6b7280' },
  chevronIcon: { fontSize: 28, color: '#9ca3af' },
  cancelButton: { alignItems: 'center', paddingVertical: 20 },
  cancelText: { fontSize: 15, color: '#ef4444', fontWeight: '500' },
});
