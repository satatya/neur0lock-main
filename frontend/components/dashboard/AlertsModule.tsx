import React, { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { P } from '../../constants/permissions';
import { useAuth } from '../../context/AuthContext';
import { alertAPI, PatientAlert } from '../../services/api';
import { useDialog } from '../common/dialogs';
import { Field, FormModal, OptionPicker, PatientPicker } from '../common/forms';
import { priorityVariant, relativeTime, titleCase } from '../common/format';
import { useAsync, useErrorToast } from '../common/hooks';
import { ActionButton, EmptyState, ErrorView, LoadingView, SectionHeader, Segmented, StatGrid } from '../common/layout';
import { Badge, Card, CardContent, useToast } from '../ui';
import { ModuleProps } from './PatientsModule';
import { moduleStyles as s } from './styles';

const DOT: Record<string, string> = { high: '#ef4444', medium: '#f59e0b', low: '#10b981' };

export function AlertsModule({ navigation, refreshKey }: ModuleProps) {
    const { can } = useAuth();
    const { showToast } = useToast();
    const { confirm } = useDialog();
    const showError = useErrorToast();
    const [status, setStatus] = useState<'open' | 'acknowledged' | 'all'>('open');
    const [formVisible, setFormVisible] = useState(false);
    const { data, loading, error, reload } = useAsync(async () => (await alertAPI.getAll(status)).data, [refreshKey, status]);
    const alerts = data ?? [];
    const open = alerts.filter((a) => !a.acknowledged_at);

    const acknowledge = async (alert: PatientAlert) => {
        try {
            await alertAPI.acknowledge(alert.id);
            showToast('Alert acknowledged', 'success');
            reload();
        } catch (e) {
            showError(e);
        }
    };

    const acknowledgeAll = async () => {
        if (!(await confirm({ title: 'Acknowledge all open alerts?', message: 'Each alert will be marked as seen by you.', confirmText: 'Acknowledge all' }))) return;
        try {
            const result = await alertAPI.acknowledgeAll();
            showToast(result.meta?.message ?? 'Alerts acknowledged', 'success');
            reload();
        } catch (e) {
            showError(e);
        }
    };

    return (
        <View>
            <SectionHeader
                title="Patient alerts"
                action={
                    can(P.ALERTS_MANAGE) ? (
                        <View style={s.row}>
                            <ActionButton label="+ Raise" small onPress={() => setFormVisible(true)} />
                            {status === 'open' && open.length > 0 ? <ActionButton label="✓ All read" small variant="secondary" onPress={acknowledgeAll} /> : null}
                        </View>
                    ) : null
                }
            />
            {status !== 'acknowledged' ? (
                <StatGrid
                    items={[
                        { label: 'High priority', value: open.filter((a) => a.priority === 'high').length, color: '#ef4444' },
                        { label: 'Medium', value: open.filter((a) => a.priority === 'medium').length, color: '#f59e0b' },
                        { label: 'Low', value: open.filter((a) => a.priority === 'low').length, color: '#10b981' },
                    ]}
                />
            ) : null}
            <Segmented
                value={status}
                onChange={setStatus}
                options={[
                    { value: 'open', label: 'Open' },
                    { value: 'acknowledged', label: 'Acknowledged' },
                    { value: 'all', label: 'All' },
                ]}
            />
            {loading && !data ? <LoadingView /> : null}
            {error ? <ErrorView message={error.message} onRetry={reload} /> : null}
            {data && alerts.length === 0 ? <EmptyState icon="🔔" message="No alerts in this view" /> : null}
            <View style={s.list}>
                {alerts.map((alert) => (
                    <Card key={alert.id}>
                        <CardContent style={s.itemContent}>
                            <View style={s.rowBetween}>
                                <View style={[s.row, { flex: 1 }]}>
                                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: DOT[alert.priority] }} />
                                    {alert.patient_id ? (
                                        <TouchableOpacity onPress={() => navigation.navigate('PatientProfileNew', { patientId: alert.patient_id })}>
                                            <Text style={[s.title, { color: '#1d4ed8' }]}>{alert.patient_name}</Text>
                                        </TouchableOpacity>
                                    ) : (
                                        <Text style={s.title}>Ward-wide</Text>
                                    )}
                                </View>
                                <View style={s.badges}>
                                    <Badge variant="outline">{titleCase(alert.category)}</Badge>
                                    <Badge variant={priorityVariant(alert.priority)}>{titleCase(alert.priority)}</Badge>
                                </View>
                            </View>
                            <Text style={s.body}>{alert.message}</Text>
                            <Text style={s.meta}>
                                ⏰ {relativeTime(alert.created_at)} · raised by {alert.created_by_name ?? 'system'}
                                {alert.acknowledged_at ? ` · ✓ acknowledged by ${alert.acknowledged_by_name ?? 'staff'} ${relativeTime(alert.acknowledged_at)}` : ''}
                            </Text>
                            {!alert.acknowledged_at && can(P.ALERTS_MANAGE) ? (
                                <View style={s.actions}>
                                    <ActionButton label="Acknowledge" variant="success" small onPress={() => acknowledge(alert)} />
                                </View>
                            ) : null}
                        </CardContent>
                    </Card>
                ))}
            </View>
            <RaiseAlertModal visible={formVisible} onClose={() => setFormVisible(false)} onSaved={reload} />
        </View>
    );
}

function RaiseAlertModal({ visible, onClose, onSaved }: { visible: boolean; onClose: () => void; onSaved: () => void }) {
    const { showToast } = useToast();
    const showError = useErrorToast();
    const [patientId, setPatientId] = useState<number | null>(null);
    const [message, setMessage] = useState('');
    const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
    const [category, setCategory] = useState('general');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async () => {
        if (!message.trim()) return setError('Enter a message');
        setSaving(true);
        setError(null);
        try {
            await alertAPI.create({ patient_id: patientId ?? undefined, message: message.trim(), priority, category });
            showToast('Alert raised', 'success');
            setMessage('');
            setPatientId(null);
            onSaved();
            onClose();
        } catch (e) {
            showError(e);
        } finally {
            setSaving(false);
        }
    };

    return (
        <FormModal visible={visible} title="Raise patient alert" onClose={onClose} onSubmit={submit} submitting={saving} submitLabel="Raise alert" error={error}>
            <PatientPicker value={patientId} onChange={(p) => setPatientId(p.id)} label="Patient (optional)" />
            <Field label="Message" required value={message} onChangeText={setMessage} placeholder="e.g. Refused evening medication" />
            <OptionPicker
                label="Priority"
                options={[
                    { value: 'high', label: 'High' },
                    { value: 'medium', label: 'Medium' },
                    { value: 'low', label: 'Low' },
                ]}
                value={priority}
                onChange={setPriority}
            />
            <OptionPicker
                label="Category"
                options={['general', 'medication', 'vitals', 'lab', 'behaviour', 'safety'].map((c) => ({ value: c, label: titleCase(c) }))}
                value={category}
                onChange={setCategory}
            />
        </FormModal>
    );
}
