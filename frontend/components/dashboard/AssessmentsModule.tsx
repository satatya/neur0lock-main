import React, { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { P } from '../../constants/permissions';
import { useAuth } from '../../context/AuthContext';
import { Assessment, assessmentAPI } from '../../services/api';
import { useDialog } from '../common/dialogs';
import { Field, FormModal, OptionPicker, PatientPicker } from '../common/forms';
import { formatDate, isValidDateString, localDate, statusVariant, titleCase } from '../common/format';
import { useAsync, useErrorToast } from '../common/hooks';
import { ActionButton, EmptyState, ErrorView, LoadingView, SectionHeader, Segmented } from '../common/layout';
import { Badge, Card, CardContent, CardHeader, CardTitle, useToast } from '../ui';
import { ModuleProps } from './PatientsModule';
import { moduleStyles as s } from './styles';

const TOOLS = ['Beck Depression Inventory', 'GAD-7', 'PHQ-9', 'PCL-5', 'Y-BOCS', 'MMPI-2', 'WAIS-IV', 'MoCA'];

export function AssessmentsModule({ navigation, refreshKey, patientId }: ModuleProps & { patientId?: number }) {
    const { can } = useAuth();
    const { showToast } = useToast();
    const { confirm } = useDialog();
    const showError = useErrorToast();
    const [filter, setFilter] = useState<'open' | 'completed' | 'all'>('open');
    const [formVisible, setFormVisible] = useState(false);
    const [completing, setCompleting] = useState<Assessment | null>(null);
    const { data, loading, error, reload } = useAsync(async () => (await assessmentAPI.getAll({ patient_id: patientId })).data, [refreshKey, patientId]);

    const assessments = (data ?? []).filter((a) =>
        filter === 'all' ? true : filter === 'completed' ? a.status === 'completed' : a.status === 'scheduled' || a.status === 'pending',
    );

    const cancel = async (assessment: Assessment) => {
        if (!(await confirm({ title: 'Cancel assessment?', message: `${assessment.assessment_type} for ${assessment.patient_name}`, confirmText: 'Cancel assessment', destructive: true }))) return;
        try {
            await assessmentAPI.update(assessment.id, { status: 'cancelled' });
            showToast('Assessment cancelled', 'success');
            reload();
        } catch (e) {
            showError(e);
        }
    };

    const remove = async (assessment: Assessment) => {
        if (!(await confirm({ title: 'Delete assessment?', message: 'This permanently removes the record.', confirmText: 'Delete', destructive: true }))) return;
        try {
            await assessmentAPI.delete(assessment.id);
            showToast('Assessment deleted', 'success');
            reload();
        } catch (e) {
            showError(e);
        }
    };

    return (
        <View>
            <SectionHeader
                title="Psychological assessments"
                action={can(P.ASSESSMENTS_CREATE) ? <ActionButton label="📋 New assessment" small onPress={() => setFormVisible(true)} /> : null}
            />
            <Segmented
                value={filter}
                onChange={setFilter}
                options={[
                    { value: 'open', label: 'Scheduled / pending' },
                    { value: 'completed', label: 'Completed' },
                    { value: 'all', label: 'All' },
                ]}
            />
            {loading && !data ? <LoadingView /> : null}
            {error ? <ErrorView message={error.message} onRetry={reload} /> : null}
            {data && assessments.length === 0 ? <EmptyState icon="📋" message="No assessments in this view" /> : null}
            <View style={s.list}>
                {assessments.map((assessment) => (
                    <Card key={assessment.id}>
                        <CardContent style={s.itemContent}>
                            <View style={s.rowBetween}>
                                <View style={{ flex: 1 }}>
                                    <Text style={s.title}>{assessment.assessment_type}</Text>
                                    {!patientId ? (
                                        <TouchableOpacity onPress={() => navigation.navigate('PatientProfileNew', { patientId: assessment.patient_id })}>
                                            <Text style={[s.subtitle, { color: '#2563eb' }]}>{assessment.patient_name}</Text>
                                        </TouchableOpacity>
                                    ) : null}
                                    <Text style={s.meta}>
                                        {formatDate(assessment.scheduled_date)} · scheduled by {assessment.scheduled_by_name ?? 'unknown'}
                                    </Text>
                                </View>
                                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                                    <Badge variant={statusVariant(assessment.status)}>{titleCase(assessment.status)}</Badge>
                                    {assessment.score ? <Badge variant="outline">Score {assessment.score}</Badge> : null}
                                </View>
                            </View>
                            {assessment.notes ? <Text style={s.body}>{assessment.notes}</Text> : null}
                            <View style={s.actions}>
                                {can(P.ASSESSMENTS_UPDATE) && (assessment.status === 'scheduled' || assessment.status === 'pending') ? (
                                    <>
                                        <ActionButton label="Record result" variant="success" small onPress={() => setCompleting(assessment)} />
                                        <ActionButton label="Cancel" variant="secondary" small onPress={() => cancel(assessment)} />
                                    </>
                                ) : null}
                                {can(P.ASSESSMENTS_DELETE) ? <ActionButton label="Delete" variant="danger" small onPress={() => remove(assessment)} /> : null}
                            </View>
                        </CardContent>
                    </Card>
                ))}
            </View>

            {!patientId ? (
                <Card style={{ marginTop: 16 }}>
                    <CardHeader>
                        <CardTitle>Available assessment tools</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <View style={s.badges}>
                            {TOOLS.map((tool) => (
                                <Badge key={tool} variant="outline">
                                    {tool}
                                </Badge>
                            ))}
                        </View>
                    </CardContent>
                </Card>
            ) : null}

            <NewAssessmentModal visible={formVisible} patientId={patientId} onClose={() => setFormVisible(false)} onSaved={reload} />
            <CompleteAssessmentModal assessment={completing} onClose={() => setCompleting(null)} onSaved={reload} />
        </View>
    );
}

function NewAssessmentModal({ visible, patientId: fixedPatient, onClose, onSaved }: { visible: boolean; patientId?: number; onClose: () => void; onSaved: () => void }) {
    const { showToast } = useToast();
    const showError = useErrorToast();
    const [patientId, setPatientId] = useState<number | null>(fixedPatient ?? null);
    const [type, setType] = useState('');
    const [date, setDate] = useState(localDate(new Date(Date.now() + 86_400_000)));
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async () => {
        if (!patientId) return setError('Select a patient');
        if (!type.trim()) return setError('Choose or enter an assessment type');
        if (!isValidDateString(date)) return setError('Enter a valid date (YYYY-MM-DD)');
        setSaving(true);
        setError(null);
        try {
            await assessmentAPI.create({ patient_id: patientId, assessment_type: type.trim(), scheduled_date: date, notes: notes.trim() || undefined, status: 'scheduled' });
            showToast('Assessment scheduled', 'success');
            setType('');
            setNotes('');
            onSaved();
            onClose();
        } catch (e) {
            showError(e);
        } finally {
            setSaving(false);
        }
    };

    return (
        <FormModal visible={visible} title="Schedule assessment" onClose={onClose} onSubmit={submit} submitting={saving} submitLabel="Schedule" error={error}>
            {fixedPatient ? null : <PatientPicker value={patientId} onChange={(p) => setPatientId(p.id)} />}
            <OptionPicker label="Assessment tool" options={TOOLS} value={type} onChange={setType} required />
            <Field label="…or another assessment" value={TOOLS.includes(type) ? '' : type} onChangeText={setType} placeholder="Custom assessment name" />
            <Field label="Scheduled date" required value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
            <Field label="Notes" value={notes} onChangeText={setNotes} multiline />
        </FormModal>
    );
}

function CompleteAssessmentModal({ assessment, onClose, onSaved }: { assessment: Assessment | null; onClose: () => void; onSaved: () => void }) {
    const { showToast } = useToast();
    const showError = useErrorToast();
    const [score, setScore] = useState('');
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);

    const submit = async () => {
        setSaving(true);
        try {
            await assessmentAPI.update(assessment!.id, { status: 'completed', score: score.trim() || null, notes: notes.trim() || assessment!.notes });
            showToast('Result recorded', 'success');
            setScore('');
            setNotes('');
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
            visible={Boolean(assessment)}
            title="Record assessment result"
            subtitle={assessment ? `${assessment.assessment_type} · ${assessment.patient_name}` : undefined}
            onClose={onClose}
            onSubmit={submit}
            submitting={saving}
            submitLabel="Mark completed"
        >
            <Field label="Score / result" value={score} onChangeText={setScore} placeholder="e.g. 14 (moderate)" />
            <Field label="Interpretation / notes" value={notes} onChangeText={setNotes} multiline />
        </FormModal>
    );
}
