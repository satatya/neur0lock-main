import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Alert } from './ui/alert.native';
import { P } from '../constants/permissions';
import { useAuth } from '../context/AuthContext';
import { therapyNoteAPI } from '../services/api';
import { useAsync } from './common/hooks';
import { ActionButton, ErrorView, LoadingView, Restricted, ScreenHeader } from './common/layout';
import { NoteList, useOpenNote } from './dashboard/NotesModule';

interface TherapyNotesScreenNewProps {
  navigation: any;
  route: any;
}

/** Encrypted therapy notes for one patient (metadata list; content decrypts after re-authentication). */
export function TherapyNotesScreenNew({ navigation, route }: TherapyNotesScreenNewProps) {
  const patientId = Number(route.params?.patientId);
  const { can } = useAuth();
  const openNote = useOpenNote(navigation);
  const [refreshKey, setRefreshKey] = useState(0);
  const allowed = can(P.NOTES_READ) || can(P.NOTES_EMERGENCY);
  const { data, loading, error, reload } = useAsync(async () => (await therapyNoteAPI.getAll(patientId)).data, [patientId, refreshKey], {
    enabled: allowed && patientId > 0,
  });
  const patientName = data?.[0]?.patient_name;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title="Therapy Notes"
        subtitle={patientName ? `${patientName} · ${data?.[0]?.patient_mrn}` : undefined}
        onBack={() => navigation.goBack()}
        right={
          can(P.NOTES_CREATE) ? <ActionButton label="+ New" small onPress={() => navigation.navigate('SecureNoteEditorNew', { patientId })} /> : null
        }
      />
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={false} onRefresh={() => setRefreshKey((k) => k + 1)} />}>
        {!allowed ? <Restricted message="Therapy notes are restricted for your role." /> : null}
        {allowed ? (
          <Alert
            variant="default"
            title="🔒 Encrypted session"
            description="Each note is encrypted with its own key. Opening a note requires re-authentication and is recorded in the audit log."
            style={styles.notice}
          />
        ) : null}
        {loading && !data ? <LoadingView /> : null}
        {error ? <ErrorView message={error.message} onRetry={reload} /> : null}
        {data ? <NoteList notes={data} onOpen={openNote} /> : null}
        <View style={styles.footer}>
          <View style={styles.statusDot} />
          <Text style={styles.footerText}>Encrypted at rest · access audited · auto sign-out enabled</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 16, paddingBottom: 40, maxWidth: 900, width: '100%', alignSelf: 'center' },
  notice: { marginBottom: 12 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 24, gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#10b981' },
  footerText: { fontSize: 12, color: '#64748b' },
});
