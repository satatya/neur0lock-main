import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Card, CardContent } from './ui/card.native';
import { Button } from './ui/button.native';
import { Badge } from './ui/badge.native';
import { Alert } from './ui/alert.native';
import { useToast } from './ui';
import { useAuth } from '../context/AuthContext';
import { authAPI } from '../services/api';
import { getCachedPatients } from '../services/offlineCache';
import { priorityVariant, relativeTime, statusVariant, titleCase } from './common/format';
import { API_BASE_URL } from '../config';

/**
 * Read-only view of the last patient list loaded in this session, for when the server becomes
 * unreachable. Nothing is written to disk; the snapshot disappears when the app is closed.
 */
export default function OfflineModeScreenNew() {
  const navigation = useNavigation<any>();
  const { refresh } = useAuth();
  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [checking, setChecking] = useState(false);
  const snapshot = getCachedPatients();

  const patients = useMemo(
    () =>
      (snapshot?.patients ?? []).filter(
        (patient) => !search || patient.full_name.toLowerCase().includes(search.toLowerCase()) || patient.mrn.toLowerCase().includes(search.toLowerCase()),
      ),
    [snapshot, search],
  );

  const reconnect = async () => {
    setChecking(true);
    try {
      await authAPI.health();
      await refresh();
      showToast('Connection restored', 'success');
      navigation.goBack();
    } catch {
      showToast(`Still offline — cannot reach ${API_BASE_URL}`, 'error');
    } finally {
      setChecking(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Text style={styles.backButtonText}>←</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Offline Mode</Text>
            <Text style={styles.headerSubtitle}>Read-only · limited data</Text>
          </View>
          <Badge variant="warning">Offline</Badge>
        </View>

        <Alert
          variant="warning"
          title="📡 Server unreachable"
          description={`NeuroLock cannot reach ${API_BASE_URL}. You can view the basic patient list loaded earlier in this session. Clinical records, notes and changes need a connection.`}
          style={styles.section}
        />

        <Button onPress={reconnect} loading={checking} style={styles.reconnect}>
          🔄 Try to reconnect
        </Button>

        {snapshot ? (
          <>
            <Text style={styles.syncText}>
              Snapshot from {relativeTime(new Date(snapshot.savedAt).toISOString())} · {snapshot.patients.length} patient(s)
            </Text>
            <TextInput style={styles.search} value={search} onChangeText={setSearch} placeholder="🔍  Search cached patients…" placeholderTextColor="#94a3b8" />
            {patients.map((patient) => (
              <Card key={patient.id} style={styles.card}>
                <CardContent>
                  <View style={styles.rowBetween}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{patient.full_name}</Text>
                      <Text style={styles.meta}>
                        {patient.mrn}
                        {patient.age !== null ? ` · ${patient.age} yrs` : ''} · {patient.ward ? `${patient.ward} ${patient.room ?? ''}` : 'Outpatient'}
                      </Text>
                    </View>
                    <View style={{ gap: 4, alignItems: 'flex-end' }}>
                      <Badge variant={statusVariant(patient.status)}>{titleCase(patient.status)}</Badge>
                      <Badge variant={priorityVariant(patient.priority)}>{titleCase(patient.priority)}</Badge>
                    </View>
                  </View>
                  <Text style={styles.meta}>
                    {patient.primary_diagnosis ?? 'No diagnosis'} · {patient.attending_physician_name ?? 'no attending physician'}
                  </Text>
                </CardContent>
              </Card>
            ))}
          </>
        ) : (
          <Card style={styles.card}>
            <CardContent>
              <Text style={styles.meta}>No patient data was loaded in this session, so nothing is available offline.</Text>
            </CardContent>
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  content: { padding: 16, paddingBottom: 40, maxWidth: 720, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 12 },
  backButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#f3f4f6', justifyContent: 'center', alignItems: 'center' },
  backButtonText: { fontSize: 24, color: '#1f2937' },
  headerTitle: { fontSize: 22, fontWeight: '600', color: '#111827' },
  headerSubtitle: { fontSize: 13, color: '#6b7280' },
  section: { marginBottom: 16 },
  reconnect: { paddingVertical: 12, marginBottom: 16 },
  syncText: { fontSize: 13, color: '#6b7280', marginBottom: 8 },
  search: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, backgroundColor: '#fff', marginBottom: 12, color: '#0f172a' },
  card: { marginBottom: 10 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  name: { fontSize: 16, fontWeight: '600', color: '#111827' },
  meta: { fontSize: 13, color: '#6b7280', marginTop: 4 },
});
