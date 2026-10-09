import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card.native';
import { Badge } from './ui/badge.native';
import { Button } from './ui/button.native';
import { useToast } from './ui';
import { useAuth } from '../context/AuthContext';
import { PERMISSION_LABELS, roleTheme } from '../constants/permissions';
import { ScreenHeader } from './common/layout';

interface MyAccessScreenNewProps {
  navigation: any;
}

/**
 * "My access": the signed-in user's role and the permissions it currently grants.
 * Roles are assigned in the directory (by sign-up approval or an administrator); the list reflects
 * the live permission set the AAA server issues for this session.
 */
export function MyAccessScreenNew({ navigation }: MyAccessScreenNewProps) {
  const { user, permissions, refresh } = useAuth();
  const { showToast } = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const theme = roleTheme(user?.role, user?.role_name);

  const groups = useMemo(() => {
    const byCategory: Record<string, { code: string; label: string; granted: boolean }[]> = {};
    for (const [code, meta] of Object.entries(PERMISSION_LABELS)) {
      (byCategory[meta.category] = byCategory[meta.category] ?? []).push({ code, label: meta.label, granted: permissions.has(code) });
    }
    return Object.entries(byCategory);
  }, [permissions]);

  const reload = async () => {
    setRefreshing(true);
    try {
      await refresh();
      showToast('Permissions refreshed', 'success');
    } catch {
      showToast('Could not refresh permissions', 'error');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="My access" subtitle={user?.email ?? user?.uid} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Card style={styles.roleCard}>
          <CardContent style={styles.roleContent}>
            <Text style={styles.roleIcon}>{theme.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.roleTitle}>{user?.role_name}</Text>
              <Text style={styles.roleSubtitle}>
                {user?.name} (@{user?.uid}) · {permissions.size} permission{permissions.size === 1 ? '' : 's'} granted
              </Text>
              {user?.acting_role ? (
                <Text style={styles.roleSubtitle}>Viewing as {user.role_name} · your own role is {user.base_role_name}</Text>
              ) : null}
            </View>
          </CardContent>
        </Card>

        <Text style={styles.explainer}>
          Your role is stored in the NeuroLock directory and checked by the AAA server on every request. What your role can do is managed
          centrally and applies immediately — if something you need is missing, ask an administrator to grant it to your role.
        </Text>

        {groups.map(([category, items]) => (
          <Card key={category} style={styles.groupCard}>
            <CardHeader>
              <CardTitle style={styles.groupTitle}>{category}</CardTitle>
            </CardHeader>
            <CardContent>
              {items.map((item) => (
                <View key={item.code} style={styles.permissionRow}>
                  <Text style={[styles.permissionIcon, { color: item.granted ? '#059669' : '#cbd5e1' }]}>{item.granted ? '✓' : '✕'}</Text>
                  <Text style={[styles.permissionLabel, !item.granted && styles.permissionDenied]}>{item.label}</Text>
                  {item.granted ? <Badge variant="success">Allowed</Badge> : <Badge variant="outline">No access</Badge>}
                </View>
              ))}
            </CardContent>
          </Card>
        ))}

        <Button variant="outline" onPress={reload} loading={refreshing} style={styles.button}>
          Refresh from server
        </Button>
        <Button onPress={() => navigation.goBack()} style={styles.button}>
          Back to dashboard
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  scrollContent: { padding: 16, paddingBottom: 40, maxWidth: 720, width: '100%', alignSelf: 'center' },
  roleCard: { marginBottom: 12 },
  roleContent: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 18 },
  roleIcon: { fontSize: 40 },
  roleTitle: { fontSize: 22, fontWeight: '700', color: '#0f172a' },
  roleSubtitle: { fontSize: 13, color: '#64748b', marginTop: 2 },
  explainer: { fontSize: 13, color: '#64748b', lineHeight: 19, marginBottom: 16 },
  groupCard: { marginBottom: 12 },
  groupTitle: { fontSize: 16 },
  permissionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  permissionIcon: { fontSize: 16, fontWeight: '700', width: 18, textAlign: 'center' },
  permissionLabel: { flex: 1, fontSize: 14, color: '#0f172a' },
  permissionDenied: { color: '#94a3b8' },
  button: { marginTop: 12, paddingVertical: 12 },
});
