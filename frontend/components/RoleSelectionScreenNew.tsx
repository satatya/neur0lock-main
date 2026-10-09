import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../context/AuthContext';
import { authAPI } from '../services/api';
import { roleTheme } from '../constants/permissions';
import { colors, ErrorView } from './common/layout';
import { useAsync, useErrorToast } from './common/hooks';
import { useHardwareBack } from './common/back';

interface RoleSelectionScreenNewProps {
  navigation: any;
}

/**
 * Administrators only: choose which role to use for this session, for testing what each role can
 * see and do. "Administrator" opens the admin dashboard. The choice is stored on the session by the
 * AAA server, so the API enforces exactly that role's permissions. Everyone else never sees this
 * screen: they are signed straight into the role assigned to their account.
 */
export function RoleSelectionScreenNew(_props: RoleSelectionScreenNewProps) {
  const { user, actAs, logout, resumeSession } = useAuth();
  const showError = useErrorToast();
  const [busy, setBusy] = useState<string | null>(null);
  const roles = useAsync(async () => (await authAPI.actAsRoles()).data, []);
  const ownRole = user?.base_role ?? 'admin';
  const current = user?.acting_role ?? ownRole;

  // Android back: continue with the current role instead of exiting
  useHardwareBack(() => {
    resumeSession();
    return true;
  });

  const choose = async (role: string) => {
    setBusy(role);
    try {
      await actAs(role === ownRole ? null : role);
    } catch (error) {
      showError(error, 'Could not switch role');
    } finally {
      setBusy(null);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.hello}>Welcome, {user?.name}</Text>
        <Text style={styles.title}>Choose how to sign in</Text>
        <Text style={styles.subtitle}>
          As an administrator you can use NeuroLock as any role to test what it can access. Every switch is recorded in the audit log, and the
          server enforces the chosen role&apos;s permissions exactly.
        </Text>

        {roles.loading ? <ActivityIndicator style={{ marginTop: 32 }} color={colors.primary} /> : null}
        {roles.error ? <ErrorView message={roles.error.message} onRetry={roles.reload} /> : null}

        <View style={styles.grid}>
          {(roles.data ?? []).map((role) => {
            const theme = roleTheme(role.name, role.display_name);
            const isOwn = role.name === ownRole;
            const isPatient = role.flags.includes('patient');
            return (
              <TouchableOpacity
                key={role.name}
                style={[styles.card, current === role.name && styles.cardCurrent]}
                onPress={() => choose(role.name)}
                disabled={busy !== null}
                activeOpacity={0.85}
                accessibilityLabel={`Sign in as ${role.display_name}`}
              >
                <LinearGradient colors={theme.colors} style={styles.cardIcon} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
                  <Text style={styles.cardIconText}>{theme.icon}</Text>
                </LinearGradient>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>
                    {role.display_name}
                    {isOwn ? '  ·  your role' : ''}
                  </Text>
                  <Text style={styles.cardText} numberOfLines={2}>
                    {isOwn
                      ? 'Admin dashboard: staff, sign-up approvals, roles & permissions, audit and security.'
                      : isPatient
                        ? 'Patient portal preview using the demo patient record.'
                        : role.description || `${role.permission_count} permissions`}
                  </Text>
                </View>
                {busy === role.name ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.chevron}>›</Text>}
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity style={styles.signOut} onPress={() => logout()}>
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingBottom: 40, maxWidth: 720, width: '100%', alignSelf: 'center' },
  hello: { fontSize: 14, color: colors.muted, marginTop: 8 },
  title: { fontSize: 26, fontWeight: '700', color: colors.text, marginTop: 4 },
  subtitle: { fontSize: 14, color: colors.muted, lineHeight: 20, marginTop: 8, marginBottom: 20 },
  grid: { gap: 12 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardCurrent: { borderColor: colors.primary, borderWidth: 2 },
  cardIcon: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardIconText: { fontSize: 24 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  cardText: { fontSize: 13, color: colors.muted, marginTop: 2 },
  chevron: { fontSize: 28, color: colors.subtle },
  signOut: { alignItems: 'center', marginTop: 24 },
  signOutText: { color: colors.danger, fontWeight: '600', fontSize: 15 },
});
