import React, { useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { P } from '../../constants/permissions';
import { useAuth } from '../../context/AuthContext';
import { Medication, medicationAPI, ScheduleSlot } from '../../services/api';
import { useDialog } from '../common/dialogs';
import { Field, FormModal, OptionPicker, PatientPicker } from '../common/forms';
import { formatDate, formatTime, localDate, localTime, statusVariant, titleCase, TIME_RE } from '../common/format';
import { useAsync, useErrorToast } from '../common/hooks';
import { ActionButton, EmptyState, ErrorView, LoadingView, SectionHeader, Segmented, StatGrid } from '../common/layout';
import { Badge, Card, CardContent, useToast } from '../ui';
import { ModuleProps } from './PatientsModule';
import { moduleStyles as s } from './styles';

type Tab = 'schedule' | 'prescriptions';

export function MedicationsModule({ navigation, refreshKey, patientId }: ModuleProps & { patientId?: number }) {
    const { can } = useAuth();
    const [tab, setTab] = useState<Tab>(can(P.MEDICATIONS_ADMINISTER) && !patientId ? 'schedule' : 'prescriptions');
    return (
        <View>
            {!patientId ? (
                <Segmented
                    value={tab}
                    onChange={setTab}
                    options={[
                        { value: 'schedule', label: "Today's schedule" },
                        { value: 'prescriptions', label: 'Prescriptions' },
                    ]}
                />
            ) : null}
            {tab === 'schedule' && !patientId ? (
                <ScheduleView refreshKey={refreshKey} />
            ) : (
                <PrescriptionsView navigation={navigation} refreshKey={refreshKey} patientId={patientId} />
            )}
        </View>
    );
}

function ScheduleView({ refreshKey }: { refreshKey: number }) {
    const { can } = useAuth();
    const { showToast } = useToast();
    const showError = useErrorToast();
    const today = localDate();
    const { data, loading, error, reload } = useAsync(async () => (await medicationAPI.schedule(today)).data, [refreshKey, today]);
    const [busy, setBusy] = useState<string | null>(null);
    const now = localTime();

    const slots = data ?? [];
    const statusOf = (slot: ScheduleSlot) => {
        if (slot.administration) return slot.administration.status === 'given' ? 'Administered' : titleCase(slot.administration.status);
        return slot.scheduled_time <= now ? 'Due' : 'Scheduled';
    };
    const stats = useMemo(
        () => ({
            administered: slots.filter((slot) => slot.administration?.status === 'given').length,
            due: slots.filter((slot) => !slot.administration && slot.scheduled_time <= now).length,
            scheduled: slots.filter((slot) => !slot.administration && slot.scheduled_time > now).length,
            other: slots.filter((slot) => slot.administration && slot.administration.status !== 'given').length,
        }),
        [slots, now],
    );

    const record = async (slot: ScheduleSlot, status: 'given' | 'refused' | 'held') => {
        const key = `${slot.medication_id}-${slot.scheduled_time}`;
        setBusy(key);
        try {
            await medicationAPI.administer(slot.medication_id, { scheduled_time: slot.scheduled_time, schedule_date: today, status });
            showToast(`${slot.name} for ${slot.patient_name}: ${status}`, status === 'given' ? 'success' : 'warning');
            await reload();
        } catch (e) {
            showError(e);
        } finally {
            setBusy(null);
        }
    };

    return (
        <View>
            <SectionHeader title="Medication schedule" subtitle={`${formatDate(today)} · ${slots.length} dose(s)`} />
            <StatGrid
                items={[
                    { label: 'Administered', value: stats.administered, color: '#059669' },
                    { label: 'Due now', value: stats.due, color: '#dc2626' },
                    { label: 'Upcoming', value: stats.scheduled },
                    { label: 'Refused / held', value: stats.other, color: '#d97706' },
                ]}
            />
            {loading && !data ? <LoadingView /> : null}
            {error ? <ErrorView message={error.message} onRetry={reload} /> : null}
            {data && slots.length === 0 ? <EmptyState icon="💊" message="No doses scheduled today" /> : null}
            <View style={s.list}>
                {slots.map((slot) => {
                    const status = statusOf(slot);
                    const key = `${slot.medication_id}-${slot.scheduled_time}`;
                    return (
                        <Card key={key}>
                            <CardContent style={s.itemContent}>
                                <View style={s.rowBetween}>
                                    <View style={{ flex: 1 }}>
                                        <Text style={s.title}>
                                            {slot.scheduled_time} · {slot.name} {slot.dose ?? ''}
                                        </Text>
                                        <Text style={s.subtitle}>
                                            {slot.patient_name} · {slot.ward ? `${slot.ward} ${slot.room ?? ''}` : slot.patient_mrn}
                                        </Text>
                                    </View>
                                    <Badge variant={status === 'Administered' ? 'success' : status === 'Due' ? 'destructive' : status === 'Scheduled' ? 'default' : 'warning'}>
                                        {status}
                                    </Badge>
                                </View>
                                {slot.instructions ? <Text style={s.body}>ℹ️ {slot.instructions}</Text> : null}
                                {slot.administration ? (
                                    <Text style={s.meta}>
                                        {titleCase(slot.administration.status)} at {formatTime(slot.administration.administered_at)} by{' '}
                                        {slot.administration.administered_by_name ?? 'unknown'}
                                    </Text>
                                ) : can(P.MEDICATIONS_ADMINISTER) ? (
                                    <View style={s.actions}>
                                        <ActionButton label="✓ Given" variant="success" small disabled={busy === key} onPress={() => record(slot, 'given')} />
                                        <ActionButton label="Refused" variant="danger" small disabled={busy === key} onPress={() => record(slot, 'refused')} />
                                        <ActionButton label="Held" variant="secondary" small disabled={busy === key} onPress={() => record(slot, 'held')} />
                                    </View>
                                ) : null}
                            </CardContent>
                        </Card>
                    );
                })}
            </View>
        </View>
    );
}

function PrescriptionsView({ navigation, refreshKey, patientId }: { navigation: any; refreshKey: number; patientId?: number }) {
    const { can } = useAuth();
    const { showToast } = useToast();
    const { confirm } = useDialog();
    const showError = useErrorToast();
    const [filter, setFilter] = useState<'active' | 'all'>('active');
    const [formVisible, setFormVisible] = useState(false);
    const { data, loading, error, reload } = useAsync(async () => (await medicationAPI.getAll({ patient_id: patientId })).data, [refreshKey, patientId]);
    const meds = (data ?? []).filter((med) => filter === 'all' || med.status !== 'discontinued');

    const setStatus = async (med: Medication, status: Medication['status']) => {
        if (status === 'discontinued') {
            const ok = await confirm({ title: 'Discontinue prescription?', message: `${med.name} ${med.dose ?? ''} for ${med.patient_name}`, confirmText: 'Discontinue', destructive: true });
            if (!ok) return;
        }
        try {
            await medicationAPI.update(med.id, { status });
            showToast(`Prescription ${status === 'on_hold' ? 'put on hold' : status}`, 'success');
            reload();
        } catch (e) {
            showError(e);
        }
    };

    return (
        <View>
            <SectionHeader
                title="Prescriptions"
                action={can(P.MEDICATIONS_PRESCRIBE) ? <ActionButton label="💊 New Rx" small onPress={() => setFormVisible(true)} /> : null}
            />
            <Segmented
                value={filter}
                onChange={setFilter}
                options={[
                    { value: 'active', label: 'Current' },
                    { value: 'all', label: 'Including discontinued' },
                ]}
            />
            {loading && !data ? <LoadingView /> : null}
            {error ? <ErrorView message={error.message} onRetry={reload} /> : null}
            {data && meds.length === 0 ? <EmptyState icon="💊" message="No prescriptions" /> : null}
            <View style={s.list}>
                {meds.map((med) => (
                    <Card key={med.id}>
                        <CardContent style={s.itemContent}>
                            <View style={s.rowBetween}>
                                <View style={{ flex: 1 }}>
                                    <Text style={s.title}>
                                        {med.name} {med.dose ?? ''}
                                    </Text>
                                    {!patientId ? (
                                        <TouchableOpacity onPress={() => navigation.navigate('PatientProfileNew', { patientId: med.patient_id })}>
                                            <Text style={[s.subtitle, { color: '#2563eb' }]}>{med.patient_name}</Text>
                                        </TouchableOpacity>
                                    ) : null}
                                </View>
                                <Badge variant={statusVariant(med.status)}>{titleCase(med.status)}</Badge>
                            </View>
                            <Text style={s.body}>
                                {med.frequency ?? '—'} · {med.route ?? 'Oral'}
                                {med.scheduled_times ? ` · at ${med.scheduled_times.split(',').join(', ')}` : ''}
                            </Text>
                            {med.instructions ? <Text style={s.meta}>ℹ️ {med.instructions}</Text> : null}
                            <Text style={s.meta}>
                                Since {formatDate(med.start_date)} · prescribed by {med.prescribed_by_name ?? 'unknown'}
                            </Text>
                            {can(P.MEDICATIONS_UPDATE) && med.status !== 'discontinued' ? (
                                <View style={s.actions}>
                                    {med.status === 'active' ? (
                                        <ActionButton label="Hold" variant="secondary" small onPress={() => setStatus(med, 'on_hold')} />
                                    ) : (
                                        <ActionButton label="Resume" variant="success" small onPress={() => setStatus(med, 'active')} />
                                    )}
                                    <ActionButton label="Discontinue" variant="danger" small onPress={() => setStatus(med, 'discontinued')} />
                                </View>
                            ) : null}
                        </CardContent>
                    </Card>
                ))}
            </View>
            <PrescribeModal visible={formVisible} patientId={patientId} onClose={() => setFormVisible(false)} onSaved={reload} />
        </View>
    );
}

function PrescribeModal({ visible, patientId: fixedPatient, onClose, onSaved }: { visible: boolean; patientId?: number; onClose: () => void; onSaved: () => void }) {
    const { showToast } = useToast();
    const showError = useErrorToast();
    const [patientId, setPatientId] = useState<number | null>(fixedPatient ?? null);
    const [name, setName] = useState('');
    const [dose, setDose] = useState('');
    const [frequency, setFrequency] = useState('Once daily');
    const [route, setRoute] = useState('Oral');
    const [times, setTimes] = useState('08:00');
    const [instructions, setInstructions] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async () => {
        if (!patientId) return setError('Select a patient');
        if (!name.trim() || !dose.trim()) return setError('Medication name and dose are required');
        const slotList = times.split(',').map((t) => t.trim()).filter(Boolean);
        if (slotList.some((t) => !TIME_RE.test(t))) return setError('Administration times must be HH:MM (24h), separated by commas');
        setSaving(true);
        setError(null);
        try {
            await medicationAPI.prescribe({ patient_id: patientId, name, dose, frequency, route, scheduled_times: slotList.join(','), instructions: instructions || undefined });
            showToast('Medication prescribed', 'success');
            setName('');
            setDose('');
            setInstructions('');
            onSaved();
            onClose();
        } catch (e) {
            showError(e);
        } finally {
            setSaving(false);
        }
    };

    return (
        <FormModal visible={visible} title="Prescribe medication" onClose={onClose} onSubmit={submit} submitting={saving} submitLabel="Prescribe" error={error}>
            {fixedPatient ? null : <PatientPicker value={patientId} onChange={(p) => setPatientId(p.id)} />}
            <Field label="Medication" required value={name} onChangeText={setName} placeholder="e.g. Sertraline" />
            <Field label="Dose" required value={dose} onChangeText={setDose} placeholder="e.g. 50mg" />
            <OptionPicker label="Frequency" options={['Once daily', 'Twice daily', 'Three times daily', 'At night', 'As needed']} value={frequency} onChange={setFrequency} />
            <OptionPicker label="Route" options={['Oral', 'Sublingual', 'Intramuscular', 'Intravenous', 'Topical']} value={route} onChange={setRoute} />
            <Field label="Administration times" value={times} onChangeText={setTimes} hint="24h HH:MM, comma-separated (e.g. 08:00,20:00). Leave empty for as-needed." />
            <Field label="Instructions" value={instructions} onChangeText={setInstructions} placeholder="e.g. Take with food" />
        </FormModal>
    );
}
