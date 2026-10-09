import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card.native';
import { Badge } from './ui/badge.native';
import { Alert } from './ui/alert.native';
import { Button } from './ui/button.native';
import { Progress } from './ui/progress.native';
import { useToast } from './ui';
import { P } from '../constants/permissions';
import { useAuth } from '../context/AuthContext';
import { useStepUp } from '../context/StepUpContext';
import { Patient, patientAPI, therapyNoteAPI } from '../services/api';
import { useDialog } from './common/dialogs';
import { Field, FormModal } from './common/forms';
import { formatDate, formatDateTime, priorityVariant, relativeTime, statusVariant, titleCase } from './common/format';
import { useAsync, useErrorToast } from './common/hooks';
import { ActionButton, EmptyState, ErrorView, InfoRow, LoadingView, Restricted, ScreenHeader, Segmented } from './common/layout';
import { PatientFormModal } from './dashboard/PatientFormModal';
import { NoteList, useOpenNote } from './dashboard/NotesModule';
import { RecordVitalsModal, VitalsGrid, vitalFlags } from './dashboard/VitalsModule';
import { MedicationsModule } from './dashboard/MedicationsModule';
import { AppointmentsModule } from './dashboard/AppointmentsModule';
import { SessionsModule } from './dashboard/SessionsModule';
import { AssessmentsModule } from './dashboard/AssessmentsModule';
import { ReportsModule } from './dashboard/ReportsModule';

interface PatientProfileScreenNewProps {
  navigation: any;
  route: any;
}

type Tab = 'overview' | 'medical' | 'therapy' | 'assessments' | 'notes' | 'reports';

/**
 * Patient record. The API only returns the sections the user's role may see (listed in
 * `restricted` otherwise), and each action button is shown only when its permission is granted.
 */
export function PatientProfileScreenNew({ navigation, route }: PatientProfileScreenNewProps) {
  const patientId = Number(route.params?.patientId);
  const { can } = useAuth();
  const { withStepUp } = useStepUp();
  const { confirm } = useDialog();
  const { showToast } = useToast();
  const showError = useErrorToast();
  const openNote = useOpenNote(navigation);
  const [tab, setTab] = useState<Tab>('overview');
  const [showSensitive, setShowSensitive] = useState(false);
  const [editing, setEditing] = useState<Patient | null>(null);
  const [vitalsFor, setVitalsFor] = useState<{ id: number; name: string } | null>(null);
  const [emergencyVisible, setEmergencyVisible] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const { data, loading, error, reload } = useAsync(async () => (await patientAPI.overview(patientId, showSensitive)).data, [patientId, showSensitive, refreshKey], {
    enabled: Number.isInteger(patientId) && patientId > 0,
  });

  if (!Number.isInteger(patientId) || patientId <= 0) {
    return (
      <SafeAreaView style={styles.container}>
        <ScreenHeader title="Patient" onBack={() => navigation.goBack()} />
        <ErrorView message="No patient selected" />
      </SafeAreaView>
    );
  }

  const patient = data?.patient;
  const sections = data?.sections ?? {};
  const restricted = new Set(data?.restricted ?? []);

  const startEdit = async () => {
    try {
      const { data: full } = await patientAPI.getById(patientId, can(P.PATIENTS_READ_SENSITIVE));
      setEditing(full);
    } catch (e) {
      showError(e);
    }
  };

  const deletePatient = async () => {
    if (!patient) return;
    const ok = await confirm({
      title: `Permanently delete ${patient.full_name}?`,
      message: 'All notes, medications, appointments and history for this patient will be deleted. This cannot be undone.',
      confirmText: 'Delete patient',
      destructive: true,
    });
    if (!ok) return;
    try {
      await withStepUp(() => patientAPI.delete(patient.id), 'Deleting a patient record requires re-authentication.');
      showToast('Patient deleted', 'success');
      navigation.goBack();
    } catch (e) {
      showError(e);
    }
  };

  const tabs: { value: Tab; label: string }[] = [
    { value: 'overview', label: 'Overview' },
    { value: 'medical', label: 'Medical' },
    { value: 'therapy', label: 'Therapy' },
    { value: 'assessments', label: 'Assessments' },
    { value: 'notes', label: 'Notes' },
    ...(can(P.REPORTS_READ) ? [{ value: 'reports' as Tab, label: 'Reports' }] : []),
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title={patient?.full_name ?? 'Patient profile'}
        subtitle={patient ? `${patient.mrn}${patient.age !== null ? ` · ${patient.age} yrs` : ''}${patient.gender ? ` · ${patient.gender}` : ''}` : undefined}
        onBack={() => navigation.goBack()}
        right={can(P.PATIENTS_UPDATE) && patient ? <ActionButton label="Edit" small variant="secondary" onPress={startEdit} /> : null}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => setRefreshKey((k) => k + 1)} />}
        keyboardShouldPersistTaps="handled"
      >
        {loading && !data ? <LoadingView label="Loading patient record…" /> : null}
        {error ? <ErrorView message={error.message} onRetry={reload} /> : null}

        {patient ? (
          <>
            <Card style={styles.summaryCard}>
              <CardContent>
                <View style={styles.summaryHeader}>
                  <View style={styles.badges}>
                    <Badge variant={statusVariant(patient.status)}>{titleCase(patient.status)}</Badge>
                    <Badge variant={priorityVariant(patient.priority)}>{titleCase(patient.priority)} priority</Badge>
                    {data?.emergency_access_active ? <Badge variant="destructive">⚠️ Emergency access active</Badge> : null}
                  </View>
                </View>
                <View style={styles.summaryGrid}>
                  <Summary label="Ward / Room" value={patient.ward ? `${patient.ward}${patient.room ? ` · ${patient.room}` : ''}` : 'Outpatient'} />
                  <Summary label="Admitted" value={formatDate(patient.admission_date)} />
                  <Summary label="Primary diagnosis" value={patient.primary_diagnosis ?? '—'} />
                  <Summary label="Allergies" value={patient.allergies ?? 'None recorded'} />
                </View>
              </CardContent>
            </Card>

            <Segmented options={tabs} value={tab} onChange={setTab} />

            {tab === 'overview' ? (
              <>
                <Card style={styles.card}>
                  <CardHeader>
                    <CardTitle>Demographics & contacts</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {patient.can_view_sensitive ? (
                      <>
                        <InfoRow label="Date of birth" value={patient.sensitive_masked ? '••••••••' : formatDate(patient.dob)} />
                        <InfoRow label="Phone" value={patient.sensitive_masked ? '••• ••• ••••' : patient.phone ?? '—'} />
                        <InfoRow label="Email" value={patient.sensitive_masked ? '••••••@••••' : patient.email ?? '—'} />
                        <InfoRow label="Address" value={patient.sensitive_masked ? '••••••••••' : patient.address ?? '—'} />
                        <InfoRow
                          label="Emergency contact"
                          value={patient.sensitive_masked ? '••••••••' : `${patient.emergency_contact_name ?? '—'}${patient.emergency_contact_phone ? ` · ${patient.emergency_contact_phone}` : ''}`}
                        />
                        <InfoRow label="Insurance" value={patient.sensitive_masked ? '••••••••' : patient.insurance ?? '—'} />
                        <Button variant="outline" onPress={() => setShowSensitive(!showSensitive)} style={styles.toggleButton}>
                          {showSensitive ? '🙈 Hide sensitive data' : '👁️ Show sensitive data (audited)'}
                        </Button>
                      </>
                    ) : (
                      <Restricted message="Date of birth, contact details and insurance are restricted for your role." />
                    )}
                  </CardContent>
                </Card>
                <Card style={styles.card}>
                  <CardHeader>
                    <CardTitle>Clinical summary</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <InfoRow label="Primary diagnosis" value={patient.primary_diagnosis} />
                    <InfoRow label="Secondary diagnosis" value={patient.secondary_diagnosis} />
                    <InfoRow label="Attending physician" value={patient.attending_physician_name ?? 'Unassigned'} />
                    <InfoRow label="Therapist / psychologist" value={patient.assigned_therapist_name ?? 'Unassigned'} />
                    <InfoRow
                      label="Care team"
                      value={patient.care_team?.length ? patient.care_team.map((member) => `${member.name} (${member.role_name ?? 'staff'})`).join(', ') : 'No other staff'}
                    />
                    {patient.next_appointment_at !== undefined ? (
                      <InfoRow label="Next appointment" value={patient.next_appointment_at ? formatDateTime(patient.next_appointment_at) : 'None scheduled'} />
                    ) : null}
                    {patient.latest_progress !== undefined && patient.latest_progress !== null ? (
                      <View style={{ marginTop: 10 }}>
                        <Text style={styles.muted}>Treatment progress {patient.latest_progress}%</Text>
                        <Progress value={patient.latest_progress} />
                      </View>
                    ) : null}
                  </CardContent>
                </Card>
                {sections.alerts && sections.alerts.length > 0 ? (
                  <Alert
                    variant="warning"
                    title={`🔔 ${sections.alerts.length} open alert(s)`}
                    description={sections.alerts.map((a) => `• ${a.message}`).join('\n')}
                    style={styles.card}
                  />
                ) : null}
                {can(P.PATIENTS_DELETE) ? (
                  <Button variant="destructive" onPress={deletePatient} style={styles.toggleButton}>
                    Delete patient record
                  </Button>
                ) : null}
              </>
            ) : null}

            {tab === 'medical' ? (
              <>
                {restricted.has('vitals') ? (
                  <Restricted message="Vital signs are restricted for your role." />
                ) : (
                  <Card style={styles.card}>
                    <CardHeader>
                      <View style={styles.rowBetween}>
                        <CardTitle>Vital signs</CardTitle>
                        {can(P.VITALS_RECORD) ? (
                          <ActionButton label="+ Record" small onPress={() => setVitalsFor({ id: patient.id, name: patient.full_name })} />
                        ) : null}
                      </View>
                    </CardHeader>
                    <CardContent>
                      {sections.vitals && sections.vitals.length > 0 ? (
                        <>
                          {vitalFlags(sections.vitals[0]).length ? (
                            <Badge variant="destructive">⚠ Out of range: {vitalFlags(sections.vitals[0]).join(', ')}</Badge>
                          ) : null}
                          <VitalsGrid vitals={sections.vitals[0]} />
                          <Text style={styles.muted}>
                            Latest {relativeTime(sections.vitals[0].recorded_at)} by {sections.vitals[0].recorded_by_name ?? 'unknown'} · {sections.vitals.length} reading(s)
                          </Text>
                        </>
                      ) : (
                        <EmptyState icon="🩺" message="No vitals recorded" />
                      )}
                    </CardContent>
                  </Card>
                )}
                {restricted.has('medications') ? (
                  <Restricted message="Medication information is restricted for your role." />
                ) : (
                  <MedicationsModule navigation={navigation} refreshKey={refreshKey} patientId={patient.id} />
                )}
              </>
            ) : null}

            {tab === 'therapy' ? (
              <>
                {restricted.has('appointments') ? (
                  <Restricted message="Appointments are restricted for your role." />
                ) : (
                  <AppointmentsModule navigation={navigation} refreshKey={refreshKey} patientId={patient.id} />
                )}
                <View style={{ height: 16 }} />
                {restricted.has('sessions') ? (
                  <Restricted message="Therapy session logs are restricted for your role." />
                ) : (
                  <SessionsModule navigation={navigation} refreshKey={refreshKey} patientId={patient.id} />
                )}
              </>
            ) : null}

            {tab === 'assessments' ? (
              restricted.has('assessments') ? (
                <Restricted message="Psychological assessments are restricted for your role." />
              ) : (
                <AssessmentsModule navigation={navigation} refreshKey={refreshKey} patientId={patient.id} />
              )
            ) : null}

            {tab === 'notes' ? (
              restricted.has('notes') ? (
                <>
                  <Restricted message="Therapy notes are restricted for your role." />
                  {can(P.NOTES_EMERGENCY) ? (
                    <Card style={styles.card}>
                      <CardContent>
                        <Text style={styles.emergencyTitle}>⚠️ Emergency access (break-glass)</Text>
                        <Text style={styles.muted}>
                          In a clinical emergency you can open this patient's notes for 60 minutes. You must give a reason; the access is flagged as a critical
                          security event and reviewed by administrators.
                        </Text>
                        <Button variant="destructive" onPress={() => setEmergencyVisible(true)} style={styles.toggleButton}>
                          Request emergency access
                        </Button>
                      </CardContent>
                    </Card>
                  ) : null}
                </>
              ) : (
                <>
                  <View style={styles.rowBetween}>
                    <Text style={styles.sectionTitle}>Therapy notes</Text>
                    {can(P.NOTES_CREATE) ? (
                      <ActionButton label="📄 New secure note" small onPress={() => navigation.navigate('SecureNoteEditorNew', { patientId: patient.id })} />
                    ) : null}
                  </View>
                  <Alert
                    variant="default"
                    title="Encrypted & audited"
                    description="Notes are stored encrypted. Opening one requires re-entering your password and is recorded in the audit log."
                    style={styles.card}
                  />
                  <NoteList notes={sections.notes ?? []} onOpen={openNote} />
                </>
              )
            ) : null}

            {tab === 'reports' ? <ReportsModule navigation={navigation} refreshKey={refreshKey} patientId={patient.id} /> : null}
          </>
        ) : null}
      </ScrollView>

      <PatientFormModal visible={Boolean(editing)} patient={editing} onClose={() => setEditing(null)} onSaved={() => setRefreshKey((k) => k + 1)} />
      <RecordVitalsModal patient={vitalsFor} onClose={() => setVitalsFor(null)} onSaved={() => setRefreshKey((k) => k + 1)} />
      <EmergencyAccessModal
        visible={emergencyVisible}
        patientId={patientId}
        patientName={patient?.full_name ?? ''}
        onClose={() => setEmergencyVisible(false)}
        onGranted={() => setRefreshKey((k) => k + 1)}
      />
    </SafeAreaView>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryItem}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

function EmergencyAccessModal({
  visible,
  patientId,
  patientName,
  onClose,
  onGranted,
}: {
  visible: boolean;
  patientId: number;
  patientName: string;
  onClose: () => void;
  onGranted: () => void;
}) {
  const { withStepUp } = useStepUp();
  const { showToast } = useToast();
  const showError = useErrorToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const { data } = await withStepUp(() => therapyNoteAPI.emergencyAccess(patientId, reason.trim()), 'Emergency access requires re-authentication.');
      showToast(`Emergency access granted until ${formatDateTime(data.expires_at)} — this has been logged`, 'warning', 6000);
      setReason('');
      onClose();
      onGranted();
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormModal
      visible={visible}
      title="Emergency access override"
      subtitle={patientName}
      onClose={onClose}
      onSubmit={submit}
      submitLabel="Grant emergency access"
      submitting={busy}
      submitDisabled={reason.trim().length < 20}
      destructive
    >
      <Alert
        variant="destructive"
        title="WARNING"
        description="Emergency access bypasses normal role restrictions. It is logged as a critical security event and reviewed by administrators. Misuse may lead to suspension."
        style={{ marginBottom: 16 }}
      />
      <Field
        label="Clinical justification"
        required
        value={reason}
        onChangeText={setReason}
        multiline
        placeholder="Describe the emergency that requires immediate access (at least 20 characters)…"
        hint={`${reason.trim().length}/20 characters minimum`}
      />
    </FormModal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 16, paddingBottom: 48, maxWidth: 1000, width: '100%', alignSelf: 'center' },
  summaryCard: { marginBottom: 12 },
  summaryHeader: { marginBottom: 8 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  summaryItem: { minWidth: 140, flexGrow: 1, flexBasis: '45%' },
  summaryLabel: { fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 },
  summaryValue: { fontSize: 15, color: '#0f172a', fontWeight: '600', marginTop: 2 },
  card: { marginBottom: 12 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  toggleButton: { marginTop: 12 },
  muted: { fontSize: 13, color: '#64748b', marginTop: 6, lineHeight: 19 },
  emergencyTitle: { fontSize: 16, fontWeight: '700', color: '#b91c1c' },
});
