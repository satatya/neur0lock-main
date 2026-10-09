import React, { useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { P } from '../../constants/permissions';
import { useAuth } from '../../context/AuthContext';
import { Appointment, appointmentAPI } from '../../services/api';
import { Col, Field, FormModal, OptionPicker, PatientPicker, Row, StaffPicker } from '../common/forms';
import { formatDateTime, localDate, localToIso, relativeTime, statusVariant, titleCase } from '../common/format';
import { useAsync, useErrorToast } from '../common/hooks';
import { ActionButton, EmptyState, ErrorView, LoadingView, SectionHeader, Segmented } from '../common/layout';
import { Badge, Card, CardContent, useToast } from '../ui';
import { ModuleProps } from './PatientsModule';
import { moduleStyles as s } from './styles';

const TYPES = ['Consultation', 'Follow-up', 'Therapy session', 'Medication review', 'Assessment', 'Group session'] as const;

type View_ = 'upcoming' | 'past' | 'all';

export function AppointmentsModule({ navigation, refreshKey, patientId }: ModuleProps & { patientId?: number }) {
    const { can, user } = useAuth();
    const { showToast } = useToast();
    const showError = useErrorToast();
    const [view, setView] = useState<View_>('upcoming');
    const [mine, setMine] = useState(false);
    const [formVisible, setFormVisible] = useState(false);
    const { data, loading, error, reload } = useAsync(
        async () => (await appointmentAPI.getAll({ patient_id: patientId, mine })).data,
        [refreshKey, mine, patientId],
    );

    const appointments = useMemo(() => {
        const now = Date.now();
        const list = (data ?? []).filter((a) => {
            const time = new Date(a.scheduled_at).getTime();
            if (view === 'upcoming') return a.status === 'scheduled' && time >= now - 60 * 60_000;
            if (view === 'past') return time < now || a.status !== 'scheduled';
            return true;
        });
        return view === 'upcoming' ? list : [...list].reverse();
    }, [data, view]);

    const updateStatus = async (appointment: Appointment, status: Appointment['status']) => {
        try {
            await appointmentAPI.update(appointment.id, { status });
            showToast(`Appointment marked ${titleCase(status)}`, 'success');
            reload();
        } catch (e) {
            showError(e);
        }
    };

    return (
        <View>
            <SectionHeader
                title="Appointments"
                action={can(P.APPOINTMENTS_CREATE) ? <ActionButton label="📅 Schedule" onPress={() => setFormVisible(true)} small /> : null}
            />
            <View style={[s.row, { marginBottom: 4 }]}>
                <Segmented
                    value={view}
                    onChange={setView}
                    options={[
                        { value: 'upcoming', label: 'Upcoming' },
                        { value: 'past', label: 'Past' },
                        { value: 'all', label: 'All' },
                    ]}
                />
            </View>
            {!patientId ? (
                <TouchableOpacity onPress={() => setMine(!mine)} style={{ marginBottom: 12 }}>
                    <Text style={{ color: '#2563eb', fontWeight: '600' }}>{mine ? '☑' : '☐'} Only my appointments</Text>
                </TouchableOpacity>
            ) : null}

            {loading && !data ? <LoadingView /> : null}
            {error ? <ErrorView message={error.message} onRetry={reload} /> : null}
            {data && appointments.length === 0 ? <EmptyState icon="📅" message={`No ${view === 'all' ? '' : view} appointments`} /> : null}

            <View style={s.list}>
                {appointments.map((appointment) => (
                    <Card key={appointment.id}>
                        <CardContent style={s.itemContent}>
                            <View style={s.rowBetween}>
                                <View style={{ flex: 1 }}>
                                    <Text style={s.title}>{formatDateTime(appointment.scheduled_at)}</Text>
                                    <Text style={s.subtitle}>
                                        {relativeTime(appointment.scheduled_at)} · {appointment.duration_min} min · {appointment.appointment_type}
                                    </Text>
                                </View>
                                <Badge variant={statusVariant(appointment.status)}>{titleCase(appointment.status)}</Badge>
                            </View>
                            <TouchableOpacity onPress={() => navigation.navigate('PatientProfileNew', { patientId: appointment.patient_id })}>
                                <Text style={[s.body, { color: '#2563eb', fontWeight: '600' }]}>
                                    {appointment.patient_name} · {appointment.patient_mrn}
                                </Text>
                            </TouchableOpacity>
                            <Text style={s.meta}>
                                With {appointment.staff_name ?? 'unassigned'}
                                {appointment.reason ? ` — ${appointment.reason}` : ''}
                            </Text>
                            {can(P.APPOINTMENTS_UPDATE) && appointment.status === 'scheduled' ? (
                                <View style={s.actions}>
                                    <ActionButton label="✓ Completed" variant="success" small onPress={() => updateStatus(appointment, 'completed')} />
                                    <ActionButton label="No-show" variant="secondary" small onPress={() => updateStatus(appointment, 'no_show')} />
                                    <ActionButton label="Cancel" variant="danger" small onPress={() => updateStatus(appointment, 'cancelled')} />
                                </View>
                            ) : null}
                        </CardContent>
                    </Card>
                ))}
            </View>

            <ScheduleAppointmentModal
                visible={formVisible}
                defaultPatientId={patientId}
                defaultStaffId={user?.id ?? null}
                onClose={() => setFormVisible(false)}
                onSaved={reload}
            />
        </View>
    );
}

function ScheduleAppointmentModal({
    visible,
    defaultPatientId,
    defaultStaffId,
    onClose,
    onSaved,
}: {
    visible: boolean;
    defaultPatientId?: number;
    defaultStaffId: number | null;
    onClose: () => void;
    onSaved: () => void;
}) {
    const { showToast } = useToast();
    const showError = useErrorToast();
    const tomorrow = localDate(new Date(Date.now() + 86_400_000));
    const [patientId, setPatientId] = useState<number | null>(defaultPatientId ?? null);
    const [date, setDate] = useState(tomorrow);
    const [time, setTime] = useState('10:00');
    const [duration, setDuration] = useState('50');
    const [type, setType] = useState<(typeof TYPES)[number]>('Consultation');
    const [reason, setReason] = useState('');
    const [staffId, setStaffId] = useState<number | null>(defaultStaffId);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async () => {
        const iso = localToIso(date, time);
        if (!patientId) return setError('Select a patient');
        if (!iso) return setError('Enter a valid date (YYYY-MM-DD) and time (HH:MM)');
        if (new Date(iso).getTime() < Date.now()) return setError('Choose a time in the future');
        setSaving(true);
        setError(null);
        try {
            await appointmentAPI.create({
                patient_id: patientId,
                scheduled_at: iso,
                duration_min: Number(duration) || 50,
                appointment_type: type,
                reason: reason.trim() || undefined,
                staff_id: staffId ?? undefined,
            });
            showToast('Appointment scheduled', 'success');
            setReason('');
            onSaved();
            onClose();
        } catch (e) {
            showError(e);
        } finally {
            setSaving(false);
        }
    };

    return (
        <FormModal visible={visible} title="Schedule appointment" onClose={onClose} onSubmit={submit} submitting={saving} submitLabel="Schedule" error={error}>
            {defaultPatientId ? null : <PatientPicker value={patientId} onChange={(p) => setPatientId(p.id)} />}
            <Row>
                <Col>
                    <Field label="Date" required value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
                </Col>
                <Col>
                    <Field label="Time" required value={time} onChangeText={setTime} placeholder="HH:MM (24h)" />
                </Col>
            </Row>
            <Field label="Duration (minutes)" value={duration} onChangeText={setDuration} keyboardType="number-pad" />
            <OptionPicker label="Type" options={TYPES} value={type} onChange={setType} />
            <Field label="Reason" value={reason} onChangeText={setReason} placeholder="e.g. Medication review" />
            <StaffPicker label="Clinician" value={staffId} onChange={setStaffId} roles={['psychiatrist', 'psychologist', 'therapist', 'nurse']} />
        </FormModal>
    );
}
