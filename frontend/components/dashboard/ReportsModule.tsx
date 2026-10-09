import React, { useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { P } from '../../constants/permissions';
import { useAuth } from '../../context/AuthContext';
import { reportAPI, ReportSummary } from '../../services/api';
import { FormModal, OptionPicker, PatientPicker } from '../common/forms';
import { formatDateTime, titleCase } from '../common/format';
import { useAsync, useErrorToast } from '../common/hooks';
import { ActionButton, EmptyState, ErrorView, LoadingView, SectionHeader } from '../common/layout';
import { Badge, Card, CardContent, useToast } from '../ui';
import { ModuleProps } from './PatientsModule';
import { moduleStyles as s } from './styles';

const TYPES = [
    { value: 'clinical-summary', label: 'Clinical summary' },
    { value: 'diagnosis-report', label: 'Diagnosis report' },
    { value: 'treatment-progress', label: 'Treatment progress' },
    { value: 'medication-review', label: 'Medication review' },
];

export function ReportsModule({ refreshKey, patientId }: ModuleProps & { patientId?: number }) {
    const { can } = useAuth();
    const showError = useErrorToast();
    const [formVisible, setFormVisible] = useState(false);
    const [viewing, setViewing] = useState<ReportSummary | null>(null);
    const { data, loading, error, reload } = useAsync(async () => (await reportAPI.getAll(patientId)).data, [refreshKey, patientId]);

    const open = async (report: ReportSummary) => {
        try {
            const { data: full } = await reportAPI.getById(report.id);
            setViewing(full);
        } catch (e) {
            showError(e);
        }
    };

    return (
        <View>
            <SectionHeader
                title="Clinical reports"
                subtitle="Generated only from data your role may view; therapy-note content is never included."
                action={can(P.REPORTS_GENERATE) ? <ActionButton label="📊 Generate" small onPress={() => setFormVisible(true)} /> : null}
            />
            {loading && !data ? <LoadingView /> : null}
            {error ? <ErrorView message={error.message} onRetry={reload} /> : null}
            {data && data.length === 0 ? <EmptyState icon="📊" message="No reports generated yet" /> : null}
            <View style={s.list}>
                {(data ?? []).map((report) => (
                    <TouchableOpacity key={report.id} onPress={() => open(report)} activeOpacity={0.75}>
                        <Card>
                            <CardContent style={s.itemContent}>
                                <View style={s.rowBetween}>
                                    <View style={{ flex: 1 }}>
                                        <Text style={s.title}>{titleCase(report.report_type)}</Text>
                                        <Text style={s.subtitle}>
                                            {report.patient_name} · {report.patient_mrn}
                                        </Text>
                                    </View>
                                    <Badge variant="outline">View</Badge>
                                </View>
                                <Text style={s.meta}>
                                    {formatDateTime(report.created_at)} · by {report.generated_by_name ?? 'unknown'}
                                </Text>
                            </CardContent>
                        </Card>
                    </TouchableOpacity>
                ))}
            </View>
            <GenerateReportModal
                visible={formVisible}
                patientId={patientId}
                onClose={() => setFormVisible(false)}
                onGenerated={(report) => {
                    reload();
                    setViewing(report);
                }}
            />
            <ReportViewer report={viewing} onClose={() => setViewing(null)} />
        </View>
    );
}

function GenerateReportModal({
    visible,
    patientId: fixedPatient,
    onClose,
    onGenerated,
}: {
    visible: boolean;
    patientId?: number;
    onClose: () => void;
    onGenerated: (report: ReportSummary) => void;
}) {
    const { showToast } = useToast();
    const showError = useErrorToast();
    const [patientId, setPatientId] = useState<number | null>(fixedPatient ?? null);
    const [type, setType] = useState('clinical-summary');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async () => {
        if (!patientId) return setError('Select a patient');
        setSaving(true);
        setError(null);
        try {
            const { data } = await reportAPI.generate(patientId, type);
            showToast('Report generated', 'success');
            onClose();
            onGenerated(data);
        } catch (e) {
            showError(e);
        } finally {
            setSaving(false);
        }
    };

    return (
        <FormModal visible={visible} title="Generate report" onClose={onClose} onSubmit={submit} submitting={saving} submitLabel="Generate" error={error}>
            {fixedPatient ? null : <PatientPicker value={patientId} onChange={(p) => setPatientId(p.id)} />}
            <OptionPicker label="Report type" options={TYPES} value={type} onChange={setType} required />
        </FormModal>
    );
}

function renderValue(value: any, depth = 0): React.ReactNode {
    if (value === null || value === undefined || value === '') return <Text style={s.meta}>—</Text>;
    if (Array.isArray(value)) {
        if (value.length === 0) return <Text style={s.meta}>None</Text>;
        return (
            <View style={{ gap: 6, marginTop: 4 }}>
                {value.map((item, index) => (
                    <View key={index} style={{ paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: '#e2e8f0' }}>
                        {typeof item === 'object' ? renderValue(item, depth + 1) : <Text style={s.body}>{String(item)}</Text>}
                    </View>
                ))}
            </View>
        );
    }
    if (typeof value === 'object') {
        return (
            <View style={{ gap: 4 }}>
                {Object.entries(value).map(([key, inner]) => (
                    <View key={key} style={{ flexDirection: typeof inner === 'object' && inner !== null ? 'column' : 'row', gap: 6, flexWrap: 'wrap' }}>
                        <Text style={[s.meta, { marginTop: 0, fontWeight: '600', color: '#475569' }]}>{titleCase(key)}:</Text>
                        {typeof inner === 'object' && inner !== null ? renderValue(inner, depth + 1) : <Text style={[s.meta, { marginTop: 0, color: '#0f172a' }]}>{String(inner)}</Text>}
                    </View>
                ))}
            </View>
        );
    }
    return <Text style={s.body}>{String(value)}</Text>;
}

function ReportViewer({ report, onClose }: { report: ReportSummary | null; onClose: () => void }) {
    const content = report?.content ?? {};
    const { report_type, generated_at, omitted_sections, ...sections } = content as Record<string, any>;
    return (
        <FormModal
            visible={Boolean(report)}
            title={report ? titleCase(report.report_type) : ''}
            subtitle={report ? `${report.patient_name} · ${formatDateTime(report.created_at)} · ${report.generated_by_name ?? ''}` : undefined}
            onClose={onClose}
        >
            <ScrollView>
                {Object.entries(sections).map(([key, value]) => (
                    <Card key={key} style={{ marginBottom: 12 }}>
                        <CardContent>
                            <Text style={[s.title, { marginBottom: 6 }]}>{titleCase(key)}</Text>
                            {renderValue(value)}
                        </CardContent>
                    </Card>
                ))}
                {Array.isArray(omitted_sections) && omitted_sections.length ? (
                    <Text style={s.meta}>🔒 Omitted (not permitted for the generating role): {omitted_sections.map(titleCase).join(', ')}</Text>
                ) : null}
            </ScrollView>
        </FormModal>
    );
}
