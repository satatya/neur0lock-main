import React, { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { P, roleTheme } from '../constants/permissions';
import { ApiError, portalAPI, PortalAppointment } from '../services/api';
import { Alert, Badge, Card, CardContent, useToast } from './ui';
import { ActionButton, colors, EmptyState, ErrorView, InfoRow, LoadingView, SectionHeader, StatGrid } from './common/layout';
import { Field, FormModal, OptionPicker } from './common/forms';
import { useAsync, useErrorToast } from './common/hooks';
import { useDialog } from './common/dialogs';
import { useTabHistory } from './common/back';
import { formatDate, formatDateTime, localDate, localToIso, statusVariant } from './common/format';
import { moduleStyles } from './dashboard/styles';

type Tab = 'overview' | 'appointments' | 'medications' | 'results';
const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'overview', label: 'Overview', icon: '🏠' },
  { key: 'appointments', label: 'Appointments', icon: '📅' },
  { key: 'medications', label: 'Medications', icon: '💊' },
  { key: 'results', label: 'Results', icon: '📋' },
];
const BOOKING_TYPES = ['Consultation', 'Follow-up', 'Therapy session', 'Medication review', 'Assessment'] as const;

/**
 * Patient portal. Shows only the signed-in patient's own record: profile, appointments (book and
 * cancel), current medications and assessment results. Therapy notes are never available here.
 */
export function PatientDashboardNew({ navigation }: { navigation: any }) {
  const { user, can, logout, chooseRole } = useAuth();
  const { confirm } = useDialog();
  const [tab, setTab] = useTabHistory<Tab>('overview');
  const [refreshKey, setRefreshKey] = useState(0);
  const theme = roleTheme('patient');

  const onLogout = async () => {
    if (await confirm({ title: 'Sign out?', message: 'You will need to sign in again to see your records.', confirmText: 'Sign out' })) await logout();
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <LinearGradient colors={theme.colors} style={styles.header} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
        <View style={styles.headerTop}>
          <View style={styles.headerLeft}>
            <Text style={styles.headerIcon}>{theme.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>My Health</Text>
              <Text style={styles.headerSubtitle} numberOfLines={1}>
                {user?.acting_role ? `Admin preview · ${user.name}` : user?.name}
              </Text>
            </View>
          </View>
          <View style={styles.headerRight}>
            {user?.can_act_as ? (
              <TouchableOpacity onPress={chooseRole} style={styles.headerButton} accessibilityLabel="Switch role">
                <Text style={styles.headerButtonText}>🔀</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity onPress={() => navigation.navigate('SettingsNew')} style={styles.headerButton} accessibilityLabel="Settings">
              <Text style={styles.headerButtonText}>⚙️</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onLogout} style={styles.headerButton} accessibilityLabel="Sign out">
              <Text style={styles.headerButtonText}>🚪</Text>
            </TouchableOpacity>
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {TABS.map((item) => (
            <TouchableOpacity key={item.key} onPress={() => setTab(item.key)} style={[styles.tab, tab === item.key && styles.tabActive]}>
              <Text style={[styles.tabText, tab === item.key && styles.tabTextActive]}>
                {item.icon} {item.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </LinearGradient>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => setRefreshKey((k) => k + 1)} />}
        keyboardShouldPersistTaps="handled"
      >
        {user?.acting_role ? (
          <Alert
            variant="warning"
            title="Patient preview"
            description="You are viewing the patient portal as an administrator, using the demo patient's record. Actions are audited under your name."
            style={{ marginBottom: 12 }}
          />
        ) : null}
        {tab === 'overview' ? <Overview key={refreshKey} onNavigate={setTab} /> : null}
        {tab === 'appointments' ? <Appointments key={refreshKey} canBook={can(P.PORTAL_BOOK)} /> : null}
        {tab === 'medications' ? <Medications key={refreshKey} /> : null}
        {tab === 'results' ? <Results key={refreshKey} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Overview({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const { data, loading, error, reload } = useAsync(async () => (await portalAPI.me()).data, []);
  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.code === 'NOT_FOUND' ? 'No patient record is linked to this account yet. Please contact the clinic.' : error.message} onRetry={reload} />;
  if (!data) return null;
  const { patient } = data;
  const next = data.upcoming_appointments[0];
  return (
    <View>
      <Text style={styles.greeting}>Hello, {patient.full_name.split(' ')[0]} 👋</Text>
      <StatGrid
        items={[
          { label: 'Upcoming appointments', value: data.upcoming_appointments.length, icon: '📅' },
          { label: 'Current medications', value: data.active_medications, icon: '💊' },
          { label: 'Patient number', value: patient.mrn, icon: '🪪' },
        ]}
      />
      <Card style={{ marginBottom: 12 }}>
        <CardContent style={moduleStyles.itemContent}>
          <SectionHeader title="Next appointment" action={<ActionButton label="Book / manage" small onPress={() => onNavigate('appointments')} />} />
          {next ? (
            <>
              <Text style={moduleStyles.title}>{formatDateTime(next.scheduled_at)}</Text>
              <Text style={moduleStyles.subtitle}>
                {next.appointment_type} with {next.clinician_name ?? 'your care team'} · {next.duration_min} min
              </Text>
            </>
          ) : (
            <Text style={moduleStyles.subtitle}>No upcoming appointments.</Text>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardContent style={moduleStyles.itemContent}>
          <SectionHeader title="My details" />
          <InfoRow label="Name" value={patient.full_name} />
          <InfoRow label="Date of birth" value={formatDate(patient.dob)} />
          <InfoRow label="Phone" value={patient.phone ?? '—'} />
          <InfoRow label="Email" value={patient.email ?? '—'} />
          <InfoRow label="Allergies" value={patient.allergies ?? 'None recorded'} />
          <InfoRow label="Doctor" value={patient.attending_physician_name ?? '—'} />
          <InfoRow label="Therapist" value={patient.assigned_therapist_name ?? '—'} />
          <InfoRow label="Emergency contact" value={patient.emergency_contact_name ? `${patient.emergency_contact_name} · ${patient.emergency_contact_phone ?? ''}` : '—'} />
          <Text style={[moduleStyles.meta, { marginTop: 10 }]}>To correct your details, please contact the clinic reception.</Text>
        </CardContent>
      </Card>
    </View>
  );
}

function Appointments({ canBook }: { canBook: boolean }) {
  const { showToast } = useToast();
  const showError = useErrorToast();
  const { confirm } = useDialog();
  const { data, loading, error, reload } = useAsync(async () => (await portalAPI.appointments()).data, []);
  const [booking, setBooking] = useState(false);

  const cancel = async (appointment: PortalAppointment) => {
    if (!(await confirm({ title: 'Cancel appointment?', message: `${appointment.appointment_type} on ${formatDateTime(appointment.scheduled_at)}`, confirmText: 'Cancel appointment', destructive: true }))) return;
    try {
      await portalAPI.cancel(appointment.id);
      showToast('Appointment cancelled', 'success');
      await reload();
    } catch (e) {
      showError(e, 'Could not cancel');
    }
  };

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  const now = Date.now();
  const upcoming = (data ?? []).filter((a) => a.status === 'scheduled' && new Date(a.scheduled_at).getTime() >= now).reverse();
  const past = (data ?? []).filter((a) => !(a.status === 'scheduled' && new Date(a.scheduled_at).getTime() >= now));

  const renderItem = (appointment: PortalAppointment) => (
    <Card key={appointment.id} style={moduleStyles.item}>
      <CardContent style={moduleStyles.itemContent}>
        <View style={moduleStyles.rowBetween}>
          <View style={{ flex: 1 }}>
            <Text style={moduleStyles.title}>{formatDateTime(appointment.scheduled_at)}</Text>
            <Text style={moduleStyles.subtitle}>
              {appointment.appointment_type} · {appointment.clinician_name ?? 'Care team'} · {appointment.duration_min} min
            </Text>
            {appointment.reason ? <Text style={moduleStyles.meta}>{appointment.reason}</Text> : null}
          </View>
          <Badge variant={statusVariant(appointment.status)}>{appointment.status.replace('_', ' ')}</Badge>
        </View>
        {canBook && appointment.can_cancel ? (
          <View style={moduleStyles.actions}>
            <ActionButton label="Cancel" small variant="danger" onPress={() => cancel(appointment)} />
          </View>
        ) : null}
      </CardContent>
    </Card>
  );

  return (
    <View>
      <SectionHeader title="Upcoming" subtitle="Cancel online up to 2 hours before" action={canBook ? <ActionButton label="+ Book" onPress={() => setBooking(true)} /> : undefined} />
      <View style={moduleStyles.list}>{upcoming.length ? upcoming.map(renderItem) : <EmptyState icon="📅" message="No upcoming appointments" />}</View>
      <View style={{ height: 20 }} />
      <SectionHeader title="Past & cancelled" />
      <View style={moduleStyles.list}>{past.length ? past.map(renderItem) : <EmptyState icon="🗂️" message="Nothing here yet" />}</View>
      {booking ? (
        <BookingModal
          onClose={() => setBooking(false)}
          onBooked={async (message) => {
            setBooking(false);
            showToast(message, 'success');
            await reload();
          }}
        />
      ) : null}
    </View>
  );
}

function BookingModal({ onClose, onBooked }: { onClose: () => void; onBooked: (message: string) => void }) {
  const clinicians = useAsync(async () => (await portalAPI.clinicians()).data, []);
  const tomorrow = new Date(Date.now() + 86_400_000);
  const [staffId, setStaffId] = useState<number | null>(null);
  const [date, setDate] = useState(localDate(tomorrow));
  const [time, setTime] = useState('10:00');
  const [type, setType] = useState<(typeof BOOKING_TYPES)[number]>('Consultation');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const iso = localToIso(date.trim(), time.trim());
    if (!staffId) return setError('Choose who you would like to see.');
    if (!iso) return setError('Enter the date as YYYY-MM-DD and the time as HH:MM.');
    setSubmitting(true);
    try {
      const { meta } = await portalAPI.book({ staff_id: staffId, scheduled_at: iso, appointment_type: type, reason: reason.trim() || undefined });
      onBooked((meta?.message as string) ?? 'Appointment booked');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Booking failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FormModal visible title="Book an appointment" subtitle="Appointments last 50 minutes" onClose={onClose} onSubmit={submit} submitLabel="Book" submitting={submitting} error={error}>
      <Text style={styles.label}>Clinician</Text>
      {clinicians.loading ? <LoadingView label="Loading clinicians…" /> : null}
      <View style={styles.chips}>
        {(clinicians.data ?? []).map((clinician) => (
          <TouchableOpacity key={clinician.id} onPress={() => setStaffId(clinician.id)} style={[styles.chip, staffId === clinician.id && styles.chipActive]}>
            <Text style={[styles.chipText, staffId === clinician.id && styles.chipTextActive]}>
              {clinician.name} · {clinician.role_name}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <Field label="Date" required value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
      <Field label="Time" required value={time} onChangeText={setTime} placeholder="HH:MM (24h)" hint="Book at least 1 hour ahead, up to 90 days." />
      <OptionPicker label="Type" options={BOOKING_TYPES} value={type} onChange={setType} />
      <Field label="Reason" value={reason} onChangeText={setReason} placeholder="Optional" maxLength={255} />
    </FormModal>
  );
}

function Medications() {
  const { data, loading, error, reload } = useAsync(async () => (await portalAPI.medications()).data, []);
  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  return (
    <View>
      <SectionHeader title="Current medications" subtitle="Prescribed by your care team" />
      <View style={moduleStyles.list}>
        {(data ?? []).length === 0 ? <EmptyState icon="💊" message="No current medications" /> : null}
        {(data ?? []).map((medication) => (
          <Card key={medication.id} style={moduleStyles.item}>
            <CardContent style={moduleStyles.itemContent}>
              <View style={moduleStyles.rowBetween}>
                <View style={{ flex: 1 }}>
                  <Text style={moduleStyles.title}>
                    {medication.name} {medication.dose ? `· ${medication.dose}` : ''}
                  </Text>
                  <Text style={moduleStyles.subtitle}>
                    {[medication.frequency, medication.route, medication.scheduled_times ? `at ${medication.scheduled_times}` : null].filter(Boolean).join(' · ')}
                  </Text>
                  {medication.instructions ? <Text style={moduleStyles.body}>{medication.instructions}</Text> : null}
                  <Text style={moduleStyles.meta}>
                    Since {formatDate(medication.start_date)}
                    {medication.prescribed_by_name ? ` · prescribed by ${medication.prescribed_by_name}` : ''}
                  </Text>
                </View>
                <Badge variant={medication.status === 'active' ? 'success' : 'warning'}>{medication.status === 'on_hold' ? 'on hold' : 'active'}</Badge>
              </View>
            </CardContent>
          </Card>
        ))}
      </View>
    </View>
  );
}

function Results() {
  const { data, loading, error, reload } = useAsync(async () => (await portalAPI.assessments()).data, []);
  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  return (
    <View>
      <SectionHeader title="Assessments" subtitle="Scores are shown once an assessment is completed" />
      <View style={moduleStyles.list}>
        {(data ?? []).length === 0 ? <EmptyState icon="📋" message="No assessments yet" /> : null}
        {(data ?? []).map((assessment) => (
          <Card key={assessment.id} style={moduleStyles.item}>
            <CardContent style={moduleStyles.itemContent}>
              <View style={moduleStyles.rowBetween}>
                <View style={{ flex: 1 }}>
                  <Text style={moduleStyles.title}>{assessment.assessment_type}</Text>
                  <Text style={moduleStyles.subtitle}>
                    {formatDate(assessment.scheduled_date)}
                    {assessment.scheduled_by_name ? ` · ${assessment.scheduled_by_name}` : ''}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <Badge variant={statusVariant(assessment.status)}>{assessment.status}</Badge>
                  {assessment.score ? <Text style={styles.score}>Score {assessment.score}</Text> : null}
                </View>
              </View>
            </CardContent>
          </Card>
        ))}
      </View>
      <Text style={[moduleStyles.meta, { marginTop: 12 }]}>Your clinician will explain what your results mean at your next appointment.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10 },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  headerIcon: { fontSize: 28 },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#fff' },
  headerSubtitle: { fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
  headerRight: { flexDirection: 'row', gap: 6 },
  headerButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  headerButtonText: { fontSize: 17 },
  tabs: { flexDirection: 'row', gap: 8, paddingTop: 14 },
  tab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.15)' },
  tabActive: { backgroundColor: '#fff' },
  tabText: { fontSize: 13, fontWeight: '600', color: '#fff' },
  tabTextActive: { color: colors.text },
  body: { padding: 16, paddingBottom: 48, maxWidth: 900, width: '100%', alignSelf: 'center' },
  greeting: { fontSize: 22, fontWeight: '700', color: colors.text, marginBottom: 12 },
  score: { fontSize: 15, fontWeight: '700', color: colors.text },
  label: { fontSize: 13, fontWeight: '600', color: '#334155', marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, color: '#334155' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
});
