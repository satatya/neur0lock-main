import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card.native';
import { Badge } from './ui/badge.native';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs.native';
import { Button } from './ui/button.native';
import { useToast } from './ui';
import { useAuth } from '../context/AuthContext';
import { ApiError, authAPI, Device, deviceAPI, UserSettings } from '../services/api';
import { useDialog } from './common/dialogs';
import { formatDate, formatDateTime, relativeTime, statusVariant, titleCase } from './common/format';
import { useAsync, useErrorToast } from './common/hooks';
import { InfoRow, ScreenHeader } from './common/layout';

interface SettingsScreenNewProps {
  navigation: any;
}

const AUTO_LOCK = [5, 15, 30, 60];
const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'हिन्दी' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
];
const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'];
const TIMEZONES = ['Asia/Kolkata', 'UTC', 'Europe/London', 'America/New_York'];

function Chips({ options, value, onChange }: { options: { value: string; label: string }[]; value?: string; onChange: (value: string) => void }) {
  return (
    <View style={styles.chips}>
      {options.map((option) => (
        <TouchableOpacity key={option.value} onPress={() => onChange(option.value)} style={[styles.chip, value === option.value && styles.chipActive]}>
          <Text style={[styles.chipText, value === option.value && styles.chipTextActive]}>{option.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function ToggleRow({ title, description, value, onChange, disabled }: { title: string; description: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <View style={styles.switchItem}>
      <View style={styles.switchItemText}>
        <Text style={styles.switchItemTitle}>{title}</Text>
        <Text style={styles.switchItemDescription}>{description}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{ false: '#d1d5db', true: '#3b82f6' }} thumbColor="#ffffff" />
    </View>
  );
}

export function SettingsScreenNew({ navigation }: SettingsScreenNewProps) {
  const { user, settings, updateSettings, mfa, biometricAvailable, biometricEnabled, setBiometricEnabled, passwordChangedAt, logout } = useAuth();
  const { showToast } = useToast();
  const { confirm } = useDialog();
  const showError = useErrorToast();

  const save = async (patch: UserSettings, message = 'Settings saved') => {
    try {
      await updateSettings(patch);
      showToast(message, 'success');
    } catch (e) {
      showError(e);
    }
  };

  const onLogout = async () => {
    if (await confirm({ title: 'Sign out?', confirmText: 'Sign out' })) await logout();
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Settings" subtitle={`${user?.role_name ?? ''} · @${user?.uid ?? ''}`} onBack={() => navigation.goBack()} />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <Tabs defaultValue="security" style={styles.tabs}>
          <TabsList>
            <TabsTrigger value="security">Security</TabsTrigger>
            <TabsTrigger value="devices">Devices</TabsTrigger>
            <TabsTrigger value="notifications">Alerts</TabsTrigger>
            <TabsTrigger value="general">General</TabsTrigger>
          </TabsList>

          <TabsContent value="security">
            <Card style={styles.settingsCard}>
              <CardHeader>
                <CardTitle>🔐 Two-step verification</CardTitle>
              </CardHeader>
              <CardContent>
                <View style={styles.statusRow}>
                  <Text style={styles.settingLabel}>Authenticator app</Text>
                  <Badge variant={mfa.enabled ? 'success' : 'warning'}>{mfa.enabled ? 'Enabled' : 'Not enabled'}</Badge>
                </View>
                {mfa.enabled ? <Text style={styles.muted}>{mfa.backup_codes_remaining} backup code(s) remaining</Text> : null}
                <View style={styles.buttonRow}>
                  <Button onPress={() => navigation.navigate('MultiFactorAuth')} style={styles.flexButton}>
                    {mfa.enabled ? 'Manage' : 'Set up'}
                  </Button>
                  {mfa.enabled ? (
                    <Button variant="outline" onPress={() => navigation.navigate('BackupCodesNew', { mode: 'manage' })} style={styles.flexButton}>
                      Backup codes
                    </Button>
                  ) : null}
                </View>
                <ToggleRow
                  title="Biometric unlock"
                  description={biometricAvailable ? 'Unlock your saved session with fingerprint / Face ID on this device' : 'Not available on this device'}
                  value={biometricEnabled}
                  disabled={!biometricAvailable}
                  onChange={async (value) => {
                    await setBiometricEnabled(value);
                    showToast(value ? 'Biometric unlock enabled on this device' : 'Biometric unlock disabled', 'success');
                  }}
                />
              </CardContent>
            </Card>

            <ChangePasswordCard passwordChangedAt={passwordChangedAt} />

            <Card style={styles.settingsCard}>
              <CardHeader>
                <CardTitle>⏱️ Session security</CardTitle>
              </CardHeader>
              <CardContent>
                <Text style={styles.settingLabel}>Automatic sign-out after inactivity</Text>
                <Chips
                  options={AUTO_LOCK.map((minutes) => ({ value: String(minutes), label: minutes === 60 ? '1 hour' : `${minutes} min` }))}
                  value={String(settings.auto_lock_minutes ?? 15)}
                  onChange={(value) => save({ auto_lock_minutes: Number(value) }, 'Auto sign-out updated')}
                />
                <ToggleRow
                  title="Login alerts"
                  description="Record an alert preference for sign-ins from new devices"
                  value={settings.login_alerts ?? true}
                  onChange={(value) => save({ login_alerts: value })}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="devices">
            <DevicesTab navigation={navigation} />
          </TabsContent>

          <TabsContent value="notifications">
            <Card style={styles.settingsCard}>
              <CardHeader>
                <CardTitle>🔔 Alert preferences</CardTitle>
              </CardHeader>
              <CardContent>
                <ToggleRow title="Email notifications" description="System updates and important alerts" value={settings.email_notifications ?? true} onChange={(v) => save({ email_notifications: v })} />
                <ToggleRow title="Security alerts" description="Login attempts and security events on your account" value={settings.security_alerts ?? true} onChange={(v) => save({ security_alerts: v })} />
                <ToggleRow title="Session reminders" description="Upcoming appointments and deadlines" value={settings.session_reminders ?? false} onChange={(v) => save({ session_reminders: v })} />
                <Text style={styles.muted}>Preferences are saved to your account.</Text>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="general">
            <Card style={styles.settingsCard}>
              <CardHeader>
                <CardTitle>🌐 Localisation</CardTitle>
              </CardHeader>
              <CardContent>
                <Text style={styles.settingLabel}>Language</Text>
                <Chips options={LANGUAGES} value={settings.language ?? 'en'} onChange={(value) => save({ language: value })} />
                <Text style={styles.settingLabel}>Time zone</Text>
                <Chips options={TIMEZONES.map((tz) => ({ value: tz, label: tz }))} value={settings.timezone ?? 'Asia/Kolkata'} onChange={(value) => save({ timezone: value })} />
                <Text style={styles.settingLabel}>Date format</Text>
                <Chips options={DATE_FORMATS.map((f) => ({ value: f, label: f }))} value={settings.date_format ?? 'DD/MM/YYYY'} onChange={(value) => save({ date_format: value })} />
              </CardContent>
            </Card>

            <Card style={styles.settingsCard}>
              <CardHeader>
                <CardTitle>👤 Account</CardTitle>
              </CardHeader>
              <CardContent>
                <InfoRow label="Name" value={user?.name} />
                <InfoRow label="Email" value={user?.email} />
                <InfoRow label="Username" value={user ? `@${user.uid}` : undefined} />
                <InfoRow label="Role" value={user?.acting_role ? `${user.role_name} (viewing as) · own role ${user.base_role_name}` : user?.role_name} />
                <InfoRow label="Account created" value={formatDate(user?.created_at)} />
                <InfoRow label="Last login" value={formatDateTime(user?.last_login_at)} />
                <InfoRow label="Password changed" value={passwordChangedAt ? relativeTime(passwordChangedAt) : '—'} />
                <Button variant="outline" onPress={() => navigation.navigate('RoleSelectionNew')} style={styles.fullButton}>
                  View my access permissions
                </Button>
              </CardContent>
            </Card>

            <Button variant="destructive" onPress={onLogout} style={styles.fullButton}>
              Sign out
            </Button>
          </TabsContent>
        </Tabs>
      </ScrollView>
    </SafeAreaView>
  );
}

function ChangePasswordCard({ passwordChangedAt }: { passwordChangedAt: string | null }) {
  const { showToast } = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmValue, setConfirmValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError('');
    if (next !== confirmValue) return setError('New passwords do not match');
    if (next.length < 8 || !/[A-Za-z]/.test(next) || !/\d/.test(next)) return setError('Use at least 8 characters with a letter and a number');
    setBusy(true);
    try {
      await authAPI.changePassword(current, next);
      setCurrent('');
      setNext('');
      setConfirmValue('');
      showToast('Password changed. Other sessions were signed out.', 'success');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not change password');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={styles.settingsCard}>
      <CardHeader>
        <CardTitle>🔑 Change password</CardTitle>
      </CardHeader>
      <CardContent>
        {passwordChangedAt ? <Text style={styles.muted}>Last changed {relativeTime(passwordChangedAt)}</Text> : null}
        <TextInput style={styles.input} value={current} onChangeText={setCurrent} placeholder="Current password" secureTextEntry placeholderTextColor="#94a3b8" />
        <TextInput style={styles.input} value={next} onChangeText={setNext} placeholder="New password" secureTextEntry placeholderTextColor="#94a3b8" />
        <TextInput style={styles.input} value={confirmValue} onChangeText={setConfirmValue} placeholder="Confirm new password" secureTextEntry placeholderTextColor="#94a3b8" />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button onPress={submit} disabled={!current || !next || !confirmValue || busy} loading={busy} style={styles.fullButton}>
          Update password
        </Button>
      </CardContent>
    </Card>
  );
}

function DevicesTab({ navigation }: { navigation: any }) {
  const { showToast } = useToast();
  const { confirm } = useDialog();
  const showError = useErrorToast();
  const { data, loading, reload } = useAsync(async () => (await deviceAPI.mine()).data, []);

  const toggleTrust = async (device: Device) => {
    try {
      await deviceAPI.setTrusted(device.id, !device.trusted);
      showToast(device.trusted ? 'Device no longer trusted' : 'Device marked as trusted', 'success');
      reload();
    } catch (e) {
      showError(e);
    }
  };

  const remove = async (device: Device) => {
    if (!(await confirm({ title: `Remove ${device.device_name}?`, message: 'The device registration will be revoked.', confirmText: 'Remove', destructive: true }))) return;
    try {
      await deviceAPI.remove(device.id);
      showToast('Device removed', 'success');
      reload();
    } catch (e) {
      showError(e);
    }
  };

  return (
    <View>
      <View style={styles.devicesHeader}>
        <Text style={styles.devicesTitle}>Registered devices</Text>
        <Button onPress={() => navigation.navigate('DeviceRegistrationNew')} size="sm">
          Register device
        </Button>
      </View>
      {loading && !data ? <Text style={styles.muted}>Loading…</Text> : null}
      {data && data.length === 0 ? (
        <Card style={styles.settingsCard}>
          <CardContent>
            <Text style={styles.muted}>No devices registered. Registration requests are approved by an administrator.</Text>
          </CardContent>
        </Card>
      ) : null}
      {(data ?? []).map((device) => (
        <Card key={device.id} style={styles.settingsCard}>
          <CardContent>
            <View style={styles.statusRow}>
              <Text style={styles.deviceName}>
                {device.device_type === 'Desktop/Laptop' || device.device_type === 'Workstation' ? '💻' : '📱'} {device.device_name}
              </Text>
              <View style={styles.badgeRow}>
                <Badge variant={statusVariant(device.status)}>{titleCase(device.status)}</Badge>
                {device.trusted ? <Badge variant="secondary">Trusted</Badge> : null}
              </View>
            </View>
            <Text style={styles.muted}>
              {device.device_type} · requested {formatDate(device.created_at)}
              {device.reviewed_by_name ? ` · reviewed by ${device.reviewed_by_name}` : ''}
            </Text>
            <View style={styles.buttonRow}>
              {device.status === 'approved' ? (
                <Button variant="outline" size="sm" onPress={() => toggleTrust(device)}>
                  {device.trusted ? 'Remove trust' : 'Trust'}
                </Button>
              ) : null}
              <Button variant="destructive" size="sm" onPress={() => remove(device)}>
                Remove
              </Button>
            </View>
          </CardContent>
        </Card>
      ))}
      <Card style={styles.settingsCard}>
        <CardHeader>
          <CardTitle>Device policy</CardTitle>
        </CardHeader>
        <CardContent>
          <Text style={styles.rule}>• New devices require re-authentication and administrator approval</Text>
          <Text style={styles.rule}>• Maximum 5 trusted devices per account</Text>
          <Text style={styles.rule}>• Administrators can sign you out of all devices if one is lost</Text>
        </CardContent>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  scrollView: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40, maxWidth: 720, width: '100%', alignSelf: 'center' },
  tabs: { flex: 0 },
  settingsCard: { marginBottom: 16 },
  settingLabel: { fontSize: 14, fontWeight: '600', color: '#374151', marginTop: 8, marginBottom: 8 },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  muted: { fontSize: 13, color: '#6b7280', marginTop: 4 },
  buttonRow: { flexDirection: 'row', gap: 8, marginTop: 12, marginBottom: 8, flexWrap: 'wrap' },
  flexButton: { flex: 1 },
  fullButton: { marginTop: 12, paddingVertical: 12 },
  switchItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#f3f4f6', gap: 12 },
  switchItemText: { flex: 1 },
  switchItemTitle: { fontSize: 15, fontWeight: '500', color: '#1f2937' },
  switchItemDescription: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#fff' },
  chipActive: { backgroundColor: '#3b82f6', borderColor: '#3b82f6' },
  chipText: { fontSize: 13, color: '#374151' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, marginTop: 10, color: '#111827', backgroundColor: '#fff' },
  error: { color: '#dc2626', marginTop: 8, fontSize: 13 },
  devicesHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  devicesTitle: { fontSize: 18, fontWeight: '600', color: '#1f2937' },
  deviceName: { fontSize: 15, fontWeight: '600', color: '#111827', flex: 1 },
  badgeRow: { flexDirection: 'row', gap: 6 },
  rule: { fontSize: 13, color: '#4b5563', marginBottom: 4 },
});
