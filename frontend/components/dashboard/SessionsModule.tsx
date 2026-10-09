import React, { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { P } from '../../constants/permissions';
import { useAuth } from '../../context/AuthContext';
import { sessionAPI } from '../../services/api';
import { Col, Field, FormModal, OptionPicker, PatientPicker, Row } from '../common/forms';
import { formatDate, formatDateTime, isValidDateString, localDate } from '../common/format';
import { useAsync, useErrorToast } from '../common/hooks';
import { ActionButton, EmptyState, ErrorView, LoadingView, SectionHeader, Segmented, StatGrid } from '../common/layout';
import { Badge, Card, CardContent, Progress, useToast } from '../ui';
import { ModuleProps } from './PatientsModule';
import { moduleStyles as s } from './styles';

const SESSION_TYPES = ['Individual', 'Group', 'Family', 'Couples', 'Assessment'] as const;

/** Therapy session logs and client progress tracking. */
export function SessionsModule({ navigation, refreshKey, patientId }: ModuleProps & { patientId?: number }) {
    const [tab, setTab] = useState<'logs' | 'progress'>('logs');
    const [mine, setMine] = useState(false);
    return (
        <View>
            {!patientId ? (
                <>
                    <Segmented
                        value={tab}
                        onChange={setTab}
                        options={[
                            { value: 'logs', label: 'Session logs' },
                            { value: 'progress', label: 'Progress tracking' },
                        ]}
                    />
                    <TouchableOpacity onPress={() => setMine(!mine)} style={{ marginBottom: 12 }}>
                        <Text style={{ color: '#2563eb', fontWeight: '600' }}>{mine ? '☑' : '☐'} Only my clients</Text>
                    </TouchableOpacity>
                </>
            ) : null}
            {tab === 'logs' ? (
                <SessionLogs navigation={navigation} refreshKey={refreshKey} patientId={patientId} mine={mine} />
            ) : (
                <ProgressView navigation={navigation} refreshKey={refreshKey} mine={mine} />
            )}
        </View>
    );
}

function SessionLogs({ navigation, refreshKey, patientId, mine }: ModuleProps & { patientId?: number; mine: boolean }) {
    const { can } = useAuth();
    const [formVisible, setFormVisible] = useState(false);
    const { data, loading, error, reload } = useAsync(async () => (await sessionAPI.getAll({ patient_id: patientId, mine })).data, [refreshKey, patientId, mine]);

    return (
        <View>
            <SectionHeader
                title="Session logs"
                subtitle={data ? `${data.length} session(s)` : undefined}
                action={can(P.SESSIONS_WRITE) ? <ActionButton label="📝 Log session" small onPress={() => setFormVisible(true)} /> : null}
            />
            {loading && !data ? <LoadingView /> : null}
            {error ? <ErrorView message={error.message} onRetry={reload} /> : null}
            {data && data.length === 0 ? <EmptyState icon="🗒️" message="No sessions logged yet" /> : null}
            <View style={s.list}>
                {(data ?? []).map((session) => (
                    <Card key={session.id}>
                        <CardContent style={s.itemContent}>
                            <View style={s.rowBetween}>
                                <View style={{ flex: 1 }}>
                                    <TouchableOpacity onPress={() => navigation.navigate('PatientProfileNew', { patientId: session.patient_id })}>
                                        <Text style={[s.title, { color: '#1d4ed8' }]}>{session.patient_name}</Text>
                                    </TouchableOpacity>
                                    <Text style={s.subtitle}>
                                        📅 {formatDate(session.session_date)} · ⏱️ {session.duration_min} min · {session.clinician_name ?? 'unknown clinician'}
                                    </Text>
                                </View>
                                <Badge variant={session.session_type === 'Individual' ? 'default' : 'secondary'}>{session.session_type}</Badge>
                            </View>
                            {session.summary ? <Text style={s.body}>{session.summary}</Text> : null}
                            {session.progress_score !== null ? (
                                <View style={s.progressRow}>
                                    <View style={s.progressLabelRow}>
                                        <Text style={s.progressLabel}>Progress after session</Text>
                                        <Text style={s.progressValue}>{session.progress_score}%</Text>
                                    </View>
                                    <Progress value={session.progress_score} />
                                </View>
                            ) : null}
                        </CardContent>
                    </Card>
                ))}
            </View>
            <LogSessionModal visible={formVisible} patientId={patientId} onClose={() => setFormVisible(false)} onSaved={reload} />
        </View>
    );
}

function ProgressView({ navigation, refreshKey, mine }: ModuleProps & { mine: boolean }) {
    const { can } = useAuth();
    const [target, setTarget] = useState<{ id: number; name: string; progress: number | null } | null>(null);
    const { data, loading, error, reload } = useAsync(async () => (await sessionAPI.progress(mine)).data, [refreshKey, mine]);
    const clients = data ?? [];
    const withProgress = clients.filter((c) => c.progress !== null);
    const average = withProgress.length ? Math.round(withProgress.reduce((sum, c) => sum + (c.progress ?? 0), 0) / withProgress.length) : 0;

    return (
        <View>
            <SectionHeader title="Progress tracking" />
            <StatGrid
                items={[
                    { label: 'Active clients', value: clients.length, icon: '👥' },
                    { label: 'Total sessions', value: clients.reduce((sum, c) => sum + Number(c.session_count), 0), icon: '🗓️' },
                    { label: 'Avg progress', value: `${average}%`, icon: '📈' },
                ]}
            />
            {loading && !data ? <LoadingView /> : null}
            {error ? <ErrorView message={error.message} onRetry={reload} /> : null}
            {data && clients.length === 0 ? <EmptyState icon="📈" message="No clients with therapy activity" /> : null}
            <View style={s.list}>
                {clients.map((client) => (
                    <Card key={client.patient_id}>
                        <CardContent style={s.itemContent}>
                            <View style={s.rowBetween}>
                                <TouchableOpacity style={{ flex: 1 }} onPress={() => navigation.navigate('PatientProfileNew', { patientId: client.patient_id })}>
                                    <Text style={[s.title, { color: '#1d4ed8' }]}>{client.patient_name}</Text>
                                    <Text style={s.subtitle}>
                                        {client.session_count} session(s) · last {formatDate(client.last_session_date)}
                                    </Text>
                                    <Text style={s.meta}>Next: {client.next_session_at ? formatDateTime(client.next_session_at) : 'not scheduled'}</Text>
                                </TouchableOpacity>
                                {can(P.SESSIONS_WRITE) ? (
                                    <ActionButton
                                        label="Update"
                                        variant="secondary"
                                        small
                                        onPress={() => setTarget({ id: client.patient_id, name: client.patient_name, progress: client.progress })}
                                    />
                                ) : null}
                            </View>
                            <View style={s.progressRow}>
                                <View style={s.progressLabelRow}>
                                    <Text style={s.progressLabel}>Progress</Text>
                                    <Text style={s.progressValue}>{client.progress === null ? 'n/a' : `${client.progress}%`}</Text>
                                </View>
                                <Progress value={client.progress ?? 0} />
                            </View>
                        </CardContent>
                    </Card>
                ))}
            </View>
            <UpdateProgressModal target={target} onClose={() => setTarget(null)} onSaved={reload} />
        </View>
    );
}

function LogSessionModal({ visible, patientId: fixedPatient, onClose, onSaved }: { visible: boolean; patientId?: number; onClose: () => void; onSaved: () => void }) {
    const { showToast } = useToast();
    const showError = useErrorToast();
    const [patientId, setPatientId] = useState<number | null>(fixedPatient ?? null);
    const [date, setDate] = useState(localDate());
    const [duration, setDuration] = useState('50');
    const [type, setType] = useState<(typeof SESSION_TYPES)[number]>('Individual');
    const [summary, setSummary] = useState('');
    const [progress, setProgress] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async () => {
        if (!patientId) return setError('Select a client');
        if (!isValidDateString(date)) return setError('Enter a valid session date (YYYY-MM-DD)');
        const score = progress.trim() === '' ? undefined : Number(progress);
        if (score !== undefined && (!Number.isInteger(score) || score < 0 || score > 100)) return setError('Progress must be a whole number from 0 to 100');
        setSaving(true);
        setError(null);
        try {
            await sessionAPI.create({ patient_id: patientId, session_date: date, duration_min: Number(duration) || 50, session_type: type, summary: summary.trim() || undefined, progress_score: score });
            showToast('Session logged', 'success');
            setSummary('');
            setProgress('');
            onSaved();
            onClose();
        } catch (e) {
            showError(e);
        } finally {
            setSaving(false);
        }
    };

    return (
        <FormModal
            visible={visible}
            title="Log therapy session"
            subtitle="Keep the summary brief; detailed clinical content belongs in an encrypted therapy note."
            onClose={onClose}
            onSubmit={submit}
            submitting={saving}
            submitLabel="Save session"
            error={error}
        >
            {fixedPatient ? null : <PatientPicker label="Client" value={patientId} onChange={(p) => setPatientId(p.id)} />}
            <Row>
                <Col>
                    <Field label="Date" required value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
                </Col>
                <Col>
                    <Field label="Duration (min)" value={duration} onChangeText={setDuration} keyboardType="number-pad" />
                </Col>
            </Row>
            <OptionPicker label="Session type" options={SESSION_TYPES} value={type} onChange={setType} />
            <Field label="Summary" value={summary} onChangeText={setSummary} multiline maxLength={500} placeholder="e.g. Practised grounding techniques" />
            <Field label="Progress (0-100)" value={progress} onChangeText={setProgress} keyboardType="number-pad" hint="Optional: updates the client's progress score" />
        </FormModal>
    );
}

function UpdateProgressModal({ target, onClose, onSaved }: { target: { id: number; name: string; progress: number | null } | null; onClose: () => void; onSaved: () => void }) {
    const { showToast } = useToast();
    const showError = useErrorToast();
    const [value, setValue] = useState('');
    const [note, setNote] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async () => {
        const score = Number(value);
        if (!Number.isInteger(score) || score < 0 || score > 100) return setError('Progress must be a whole number from 0 to 100');
        setSaving(true);
        setError(null);
        try {
            await sessionAPI.updateProgress(target!.id, score, note.trim() || undefined);
            showToast(`Progress for ${target!.name} set to ${score}%`, 'success');
            setValue('');
            setNote('');
            onSaved();
            onClose();
        } catch (e) {
            showError(e);
        } finally {
            setSaving(false);
        }
    };

    return (
        <FormModal
            visible={Boolean(target)}
            title="Update client progress"
            subtitle={target ? `${target.name} · current ${target.progress ?? 'n/a'}%` : undefined}
            onClose={onClose}
            onSubmit={submit}
            submitting={saving}
            submitLabel="Update"
            error={error}
        >
            <Field label="Progress (0-100)" required value={value} onChangeText={setValue} keyboardType="number-pad" autoFocus />
            <Field label="Note" value={note} onChangeText={setNote} placeholder="Optional short note" />
        </FormModal>
    );
}
