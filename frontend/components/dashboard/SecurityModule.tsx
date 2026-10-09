import React from 'react';
import { Text, View } from 'react-native';
import { P } from '../../constants/permissions';
import { useAuth } from '../../context/AuthContext';
import { useStepUp } from '../../context/StepUpContext';
import { deviceAPI, securityAPI } from '../../services/api';
import { useDialog } from '../common/dialogs';
import { formatDateTime, formatTime, relativeTime, severityVariant, titleCase } from '../common/format';
import { useAsync, useErrorToast } from '../common/hooks';
import { ActionButton, EmptyState, ErrorView, InfoRow, LoadingView, SectionHeader, StatGrid } from '../common/layout';
import { Badge, Card, CardContent, CardHeader, CardTitle, useToast } from '../ui';
import { ModuleProps } from './PatientsModule';
import { moduleStyles as s } from './styles';

export function SecurityModule({ navigation, refreshKey }: ModuleProps) {
    const { can, user } = useAuth();
    const { withStepUp } = useStepUp();
    const { notice } = useDialog();
    const { showToast } = useToast();
    const showError = useErrorToast();
    const manage = can(P.STAFF_MANAGE);

    const { data, loading, error, reload } = useAsync(async () => {
        const [overview, alerts, sessions, devices, resets] = await Promise.all([
            securityAPI.overview(),
            securityAPI.alerts({ status: 'unreviewed' }),
            securityAPI.sessions(),
            deviceAPI.getAll('pending'),
            manage ? securityAPI.passwordResets() : Promise.resolve({ data: [] as any[] }),
        ]);
        return { overview: overview.data, alerts: alerts.data, sessions: sessions.data, devices: devices.data, resets: resets.data };
    }, [refreshKey, manage]);

    const act = async (action: () => Promise<unknown>, success: string) => {
        try {
            await withStepUp(action);
            showToast(success, 'success');
            reload();
        } catch (e) {
            showError(e);
        }
    };

    const issueReset = async (reset: any) => {
        try {
            const { data: issued } = await withStepUp(() => securityAPI.issueReset(reset.id), 'Issuing a password reset code requires re-authentication.');
            await notice({
                title: 'One-time reset code',
                message: `Verify the identity of ${reset.staff_name} before sharing this code. They use it on the "Forgot password" screen with the username ${issued.username}. Expires at ${formatTime(issued.expires_at)}.`,
                codes: [issued.code],
            });
            reload();
        } catch (e) {
            showError(e);
        }
    };

    if (loading && !data) return <LoadingView />;
    if (error) return <ErrorView message={error.message} onRetry={reload} />;
    if (!data) return null;
    const o = data.overview;

    return (
        <View>
            <SectionHeader
                title="Security centre"
                action={<ActionButton label="All alerts" small onPress={() => navigation.navigate('SecurityAlertsNew')} />}
            />
            <StatGrid
                items={[
                    { label: 'Failed logins (24h)', value: o.failed_logins_24h, icon: '❌', color: '#dc2626' },
                    { label: 'Locked accounts', value: o.locked_accounts, icon: '🔒' },
                    { label: 'Access denied (24h)', value: o.denied_24h, icon: '⛔' },
                    { label: 'Break-glass (7d)', value: o.emergency_access_7d, icon: '🚨', color: '#d97706' },
                ]}
            />

            <Card style={{ marginBottom: 12 }}>
                <CardHeader>
                    <CardTitle>Unreviewed security alerts ({data.alerts.length})</CardTitle>
                </CardHeader>
                <CardContent>
                    {data.alerts.length === 0 ? <EmptyState icon="✅" message="Nothing to review" /> : null}
                    {data.alerts.slice(0, 5).map((alert) => (
                        <View key={alert.id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}>
                            <View style={s.rowBetween}>
                                <Text style={[s.title, { fontSize: 14, flex: 1 }]}>{alert.title}</Text>
                                <Badge variant={severityVariant(alert.severity)}>{titleCase(alert.severity)}</Badge>
                            </View>
                            <Text style={s.meta}>
                                {alert.actor_name ?? alert.actor ?? 'unknown'} · {relativeTime(alert.ts)}
                                {alert.patient_name ? ` · patient ${alert.patient_name}` : ''}
                            </Text>
                            <View style={s.actions}>
                                <ActionButton label="Mark resolved" small variant="success" onPress={() => act(() => securityAPI.review(alert.id, 'resolved'), 'Alert reviewed')} />
                                <ActionButton label="False positive" small variant="secondary" onPress={() => act(() => securityAPI.review(alert.id, 'false_positive'), 'Alert dismissed')} />
                            </View>
                        </View>
                    ))}
                    {data.alerts.length > 5 ? (
                        <ActionButton label={`View all ${data.alerts.length} alerts`} variant="ghost" small onPress={() => navigation.navigate('SecurityAlertsNew')} />
                    ) : null}
                </CardContent>
            </Card>

            {manage ? (
                <Card style={{ marginBottom: 12 }}>
                    <CardHeader>
                        <CardTitle>Password reset requests ({data.resets.length})</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {data.resets.length === 0 ? <Text style={s.meta}>No pending requests</Text> : null}
                        {data.resets.map((reset: any) => (
                            <View key={reset.id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}>
                                <Text style={[s.title, { fontSize: 14 }]}>{reset.staff_name}</Text>
                                <Text style={s.meta}>
                                    {reset.staff_email} · requested {relativeTime(reset.requested_at)}
                                    {reset.status === 'issued' ? ` · code issued, expires ${formatTime(reset.expires_at)}` : ''}
                                </Text>
                                <View style={s.actions}>
                                    <ActionButton label={reset.status === 'issued' ? 'Re-issue code' : 'Issue code'} small onPress={() => issueReset(reset)} />
                                    <ActionButton label="Reject" small variant="danger" onPress={() => act(() => securityAPI.rejectReset(reset.id), 'Request rejected')} />
                                </View>
                            </View>
                        ))}
                    </CardContent>
                </Card>
            ) : null}

            <Card style={{ marginBottom: 12 }}>
                <CardHeader>
                    <CardTitle>Device registration requests ({data.devices.length})</CardTitle>
                </CardHeader>
                <CardContent>
                    {data.devices.length === 0 ? <Text style={s.meta}>No pending devices</Text> : null}
                    {data.devices.map((device) => (
                        <View key={device.id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}>
                            <Text style={[s.title, { fontSize: 14 }]}>
                                {device.device_name} · {device.device_type}
                            </Text>
                            <Text style={s.meta}>
                                {device.staff_name} · {relativeTime(device.created_at)}
                            </Text>
                            {device.justification ? <Text style={s.body}>“{device.justification}”</Text> : null}
                            {manage ? (
                                <View style={s.actions}>
                                    <ActionButton label="Approve" small variant="success" onPress={() => act(() => deviceAPI.approve(device.id), 'Device approved')} />
                                    <ActionButton label="Reject" small variant="danger" onPress={() => act(() => deviceAPI.reject(device.id), 'Device rejected')} />
                                </View>
                            ) : null}
                        </View>
                    ))}
                </CardContent>
            </Card>

            <Card style={{ marginBottom: 12 }}>
                <CardHeader>
                    <CardTitle>Active sessions ({data.sessions.length})</CardTitle>
                </CardHeader>
                <CardContent>
                    {data.sessions.map((session) => (
                        <View key={session.id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}>
                            <View style={s.rowBetween}>
                                <View style={{ flex: 1 }}>
                                    <Text style={[s.title, { fontSize: 14 }]}>
                                        {session.staff_name} · {session.role_name}{session.acting_role ? ` (viewing as ${session.acting_role})` : ''}
                                    </Text>
                                    <Text style={s.meta}>
                                        Signed in {formatDateTime(session.created_at)} · active {relativeTime(session.last_seen_at)} · IP {session.ip ?? '?'}
                                    </Text>
                                </View>
                                {manage && session.uid !== user?.uid ? (
                                    <ActionButton label="Sign out" small variant="danger" onPress={() => act(() => securityAPI.revokeSession(session.id), 'Session signed out')} />
                                ) : null}
                            </View>
                        </View>
                    ))}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>System health</CardTitle>
                </CardHeader>
                <CardContent>
                    <InfoRow label="💾 Database" value={titleCase(o.database)} />
                    <InfoRow label="🔒 Encryption at rest" value={o.encryption} />
                    <InfoRow label="🛡️ MFA adoption" value={`${o.mfa_enabled} of ${o.active_staff} active staff`} />
                    <InfoRow label="🔐 Active sessions" value={String(o.active_sessions)} />
                </CardContent>
            </Card>
        </View>
    );
}
