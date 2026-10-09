import React, { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { AuditEntry, auditAPI } from '../../services/api';
import { formatDateTime, relativeTime, severityVariant, statusVariant, titleCase } from '../common/format';
import { useAsync, useErrorToast } from '../common/hooks';
import { ActionButton, EmptyState, ErrorView, LoadingView, SectionHeader, Segmented, StatGrid } from '../common/layout';
import { shareText, toCsv } from '../common/share';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '../ui';
import { ModuleProps } from './PatientsModule';
import { moduleStyles as s } from './styles';

type OutcomeFilter = 'all' | 'success' | 'denied' | 'failure';

export function describeAudit(entry: AuditEntry): string {
    const target = entry.patient_name ? ` — patient ${entry.patient_name}` : entry.resource_id ? ` #${entry.resource_id}` : '';
    return `${titleCase(entry.action)} · ${titleCase(entry.resource)}${target}`;
}

export function AuditEntryCard({ entry }: { entry: AuditEntry }) {
    return (
        <Card>
            <CardContent style={s.itemContent}>
                <View style={s.rowBetween}>
                    <View style={{ flex: 1 }}>
                        <Text style={s.title}>{entry.actor_name ?? entry.actor ?? 'Anonymous'}</Text>
                        <Text style={s.subtitle}>
                            {entry.actor_role ? `${titleCase(entry.actor_role)} · ` : ''}
                            {formatDateTime(entry.ts)} ({relativeTime(entry.ts)})
                        </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 6 }}>
                        <Badge variant={statusVariant(entry.outcome)}>{titleCase(entry.outcome)}</Badge>
                        {entry.severity !== 'info' ? <Badge variant={severityVariant(entry.severity)}>{titleCase(entry.severity)}</Badge> : null}
                    </View>
                </View>
                <Text style={s.body}>{describeAudit(entry)}</Text>
                {entry.details ? (
                    <Text style={s.meta} numberOfLines={3}>
                        {Object.entries(entry.details)
                            .map(([key, value]) => `${titleCase(key)}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
                            .join(' · ')}
                    </Text>
                ) : null}
                <Text style={s.meta}>IP {entry.ip ?? 'unknown'}</Text>
            </CardContent>
        </Card>
    );
}

export function AuditModule({ navigation, refreshKey }: ModuleProps) {
    const showError = useErrorToast();
    const [search, setSearch] = useState('');
    const [query, setQuery] = useState('');
    const [outcome, setOutcome] = useState<OutcomeFilter>('all');
    const stats = useAsync(async () => (await auditAPI.stats()).data, [refreshKey]);
    const { data, loading, error, reload } = useAsync(
        async () => (await auditAPI.getAll({ q: query, outcome: outcome === 'all' ? undefined : outcome, limit: 50 })).data,
        [refreshKey, query, outcome],
    );

    const exportCsv = async () => {
        try {
            const { data: rows } = await auditAPI.getAll({ q: query, outcome: outcome === 'all' ? undefined : outcome, limit: 500 });
            await shareText(
                `neurolock-audit-${new Date().toISOString().slice(0, 10)}.csv`,
                toCsv(rows as unknown as Record<string, unknown>[], ['id', 'ts', 'actor', 'actor_uid', 'actor_role', 'action', 'resource', 'resource_id', 'patient_id', 'outcome', 'severity', 'ip', 'details']),
            );
        } catch (e) {
            showError(e);
        }
    };

    const st = stats.data;
    return (
        <View>
            <SectionHeader
                title="System audit log"
                subtitle="Append-only record of every sign-in, record access and change"
                action={
                    <View style={s.row}>
                        <ActionButton label="📥 Export" small variant="secondary" onPress={exportCsv} />
                        <ActionButton label="Full log" small onPress={() => navigation.navigate('StaffActivityLogsNew')} />
                    </View>
                }
            />
            {st ? (
                <StatGrid
                    items={[
                        { label: 'Actions today', value: st.actions_today, icon: '📊' },
                        { label: 'Active users today', value: st.active_users_today, icon: '👥' },
                        { label: 'Failed logins (24h)', value: st.failed_logins_24h, icon: '❌', color: '#dc2626' },
                        { label: 'Access denied (24h)', value: st.denied_24h, icon: '⛔', color: '#d97706' },
                    ]}
                />
            ) : null}
            {st ? (
                <Card style={{ marginBottom: 12 }}>
                    <CardHeader>
                        <CardTitle>Last 24 hours</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <View style={s.rowBetween}>
                            <Text style={s.body}>📖 Record views</Text>
                            <Text style={s.title}>{st.record_views_24h}</Text>
                        </View>
                        <View style={s.rowBetween}>
                            <Text style={s.body}>✏️ Modifications</Text>
                            <Text style={s.title}>{st.modifications_24h}</Text>
                        </View>
                        <View style={s.rowBetween}>
                            <Text style={s.body}>➕ Creations</Text>
                            <Text style={s.title}>{st.creations_24h}</Text>
                        </View>
                        <View style={s.rowBetween}>
                            <Text style={s.body}>🚨 Security events</Text>
                            <Text style={s.title}>{st.security_events_24h}</Text>
                        </View>
                    </CardContent>
                </Card>
            ) : null}
            <TextInput
                style={s.search}
                value={search}
                onChangeText={setSearch}
                onSubmitEditing={() => setQuery(search.trim())}
                onBlur={() => setQuery(search.trim())}
                placeholder="🔍  Search user, action or resource (press enter)…"
                placeholderTextColor="#94a3b8"
                returnKeyType="search"
            />
            <Segmented
                value={outcome}
                onChange={setOutcome}
                options={[
                    { value: 'all', label: 'All' },
                    { value: 'success', label: 'Success' },
                    { value: 'denied', label: 'Denied' },
                    { value: 'failure', label: 'Failed' },
                ]}
            />
            {loading && !data ? <LoadingView /> : null}
            {error ? <ErrorView message={error.message} onRetry={reload} /> : null}
            {data && data.length === 0 ? <EmptyState message="No audit entries match" /> : null}
            <View style={s.list}>
                {(data ?? []).map((entry) => (
                    <AuditEntryCard key={entry.id} entry={entry} />
                ))}
            </View>
        </View>
    );
}
