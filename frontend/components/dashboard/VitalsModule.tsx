import React, { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { P } from '../../constants/permissions';
import { useAuth } from '../../context/AuthContext';
import { Vitals, vitalsAPI } from '../../services/api';
import { Col, Field, FormModal, Row } from '../common/forms';
import { formatDateTime, relativeTime } from '../common/format';
import { useAsync, useErrorToast } from '../common/hooks';
import { ActionButton, EmptyState, ErrorView, LoadingView, SectionHeader } from '../common/layout';
import { Badge, Card, CardContent, useToast } from '../ui';
import { ModuleProps } from './PatientsModule';
import { moduleStyles as s } from './styles';

/** Flags readings outside common adult reference ranges. */
export function vitalFlags(v: Pick<Vitals, 'heart_rate' | 'bp_systolic' | 'bp_diastolic' | 'temperature_c' | 'spo2'>): string[] {
    const flags: string[] = [];
    if (v.heart_rate !== null && (v.heart_rate < 50 || v.heart_rate > 100)) flags.push('Heart rate');
    if (v.bp_systolic !== null && (v.bp_systolic >= 140 || v.bp_systolic < 90)) flags.push('Blood pressure');
    if (v.temperature_c !== null && (v.temperature_c >= 38 || v.temperature_c < 35.5)) flags.push('Temperature');
    if (v.spo2 !== null && v.spo2 < 95) flags.push('SpO2');
    return flags;
}

export function VitalsGrid({ vitals }: { vitals: Vitals }) {
    return (
        <View style={s.grid}>
            <View style={s.gridItem}>
                <Text style={s.gridLabel}>❤️ Heart rate</Text>
                <Text style={s.gridValue}>{vitals.heart_rate ?? '—'} bpm</Text>
            </View>
            <View style={s.gridItem}>
                <Text style={s.gridLabel}>🩸 Blood pressure</Text>
                <Text style={s.gridValue}>{vitals.bp_systolic && vitals.bp_diastolic ? `${vitals.bp_systolic}/${vitals.bp_diastolic}` : '—'}</Text>
            </View>
            <View style={s.gridItem}>
                <Text style={s.gridLabel}>🌡️ Temperature</Text>
                <Text style={s.gridValue}>{vitals.temperature_c !== null ? `${vitals.temperature_c} °C` : '—'}</Text>
            </View>
            <View style={s.gridItem}>
                <Text style={s.gridLabel}>🫁 SpO2 / Resp.</Text>
                <Text style={s.gridValue}>
                    {vitals.spo2 ?? '—'}% · {vitals.respiratory_rate ?? '—'}/min
                </Text>
            </View>
        </View>
    );
}

export function VitalsModule({ navigation, refreshKey }: ModuleProps) {
    const { can } = useAuth();
    const [recordFor, setRecordFor] = useState<{ id: number; name: string } | null>(null);
    const { data, loading, error, reload } = useAsync(async () => (await vitalsAPI.latest()).data, [refreshKey]);

    return (
        <View>
            <SectionHeader title="Patient vitals" subtitle="Latest reading per patient" />
            {loading && !data ? <LoadingView /> : null}
            {error ? <ErrorView message={error.message} onRetry={reload} /> : null}
            {data && data.length === 0 ? <EmptyState icon="🩺" message="No patients" /> : null}
            <View style={s.list}>
                {(data ?? []).map((row) => {
                    const flags = row.id ? vitalFlags(row) : [];
                    return (
                        <Card key={row.patient_id}>
                            <CardContent style={s.itemContent}>
                                <View style={s.rowBetween}>
                                    <TouchableOpacity style={{ flex: 1 }} onPress={() => navigation.navigate('PatientProfileNew', { patientId: row.patient_id })}>
                                        <Text style={[s.title, { color: '#1d4ed8' }]}>{row.patient_name}</Text>
                                        <Text style={s.subtitle}>{row.ward ? `${row.ward}${row.room ? ` · Room ${row.room}` : ''}` : row.patient_mrn}</Text>
                                    </TouchableOpacity>
                                    {flags.length ? <Badge variant="destructive">⚠ {flags.join(', ')}</Badge> : row.id ? <Badge variant="success">Normal</Badge> : null}
                                </View>
                                {row.id ? (
                                    <>
                                        <VitalsGrid vitals={row} />
                                        <Text style={s.meta}>
                                            Last checked {relativeTime(row.recorded_at)} ({formatDateTime(row.recorded_at)}) by {row.recorded_by_name ?? 'unknown'}
                                        </Text>
                                    </>
                                ) : (
                                    <Text style={s.meta}>No readings recorded yet</Text>
                                )}
                                {can(P.VITALS_RECORD) ? (
                                    <View style={s.actions}>
                                        <ActionButton label="+ Record vitals" small variant="secondary" onPress={() => setRecordFor({ id: row.patient_id, name: row.patient_name ?? '' })} />
                                    </View>
                                ) : null}
                            </CardContent>
                        </Card>
                    );
                })}
            </View>
            <RecordVitalsModal patient={recordFor} onClose={() => setRecordFor(null)} onSaved={reload} />
        </View>
    );
}

export function RecordVitalsModal({ patient, onClose, onSaved }: { patient: { id: number; name: string } | null; onClose: () => void; onSaved: () => void }) {
    const { showToast } = useToast();
    const showError = useErrorToast();
    const [values, setValues] = useState({ heart_rate: '', bp_systolic: '', bp_diastolic: '', temperature_c: '', respiratory_rate: '', spo2: '', notes: '' });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const set = (key: keyof typeof values) => (text: string) => setValues((current) => ({ ...current, [key]: text }));

    const submit = async () => {
        const payload: Record<string, unknown> = { patient_id: patient!.id };
        for (const [key, value] of Object.entries(values)) {
            if (!value.trim()) continue;
            if (key === 'notes') {
                payload.notes = value.trim();
                continue;
            }
            const number = Number(value.replace(',', '.'));
            if (!Number.isFinite(number)) return setError(`${key.replace('_', ' ')} must be a number`);
            payload[key] = number;
        }
        if (Object.keys(payload).length === 1) return setError('Enter at least one measurement');
        setSaving(true);
        setError(null);
        try {
            await vitalsAPI.record(payload);
            showToast(`Vitals recorded for ${patient!.name}`, 'success');
            setValues({ heart_rate: '', bp_systolic: '', bp_diastolic: '', temperature_c: '', respiratory_rate: '', spo2: '', notes: '' });
            onSaved();
            onClose();
        } catch (e) {
            showError(e);
        } finally {
            setSaving(false);
        }
    };

    return (
        <FormModal visible={Boolean(patient)} title="Record vitals" subtitle={patient?.name} onClose={onClose} onSubmit={submit} submitting={saving} submitLabel="Save reading" error={error}>
            <Row>
                <Col>
                    <Field label="Heart rate (bpm)" value={values.heart_rate} onChangeText={set('heart_rate')} keyboardType="number-pad" />
                </Col>
                <Col>
                    <Field label="SpO2 (%)" value={values.spo2} onChangeText={set('spo2')} keyboardType="number-pad" />
                </Col>
            </Row>
            <Row>
                <Col>
                    <Field label="Systolic BP" value={values.bp_systolic} onChangeText={set('bp_systolic')} keyboardType="number-pad" />
                </Col>
                <Col>
                    <Field label="Diastolic BP" value={values.bp_diastolic} onChangeText={set('bp_diastolic')} keyboardType="number-pad" />
                </Col>
            </Row>
            <Row>
                <Col>
                    <Field label="Temperature (°C)" value={values.temperature_c} onChangeText={set('temperature_c')} keyboardType="decimal-pad" />
                </Col>
                <Col>
                    <Field label="Resp. rate (/min)" value={values.respiratory_rate} onChangeText={set('respiratory_rate')} keyboardType="number-pad" />
                </Col>
            </Row>
            <Field label="Notes" value={values.notes} onChangeText={set('notes')} />
        </FormModal>
    );
}
