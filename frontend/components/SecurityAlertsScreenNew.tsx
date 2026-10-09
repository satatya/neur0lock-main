import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, CardContent } from './ui/card.native';
import { Badge } from './ui/badge.native';
import { useToast } from './ui';
import { P } from '../constants/permissions';
import { useAuth } from '../context/AuthContext';
import { SecurityAlert, securityAPI } from '../services/api';
import { Field, FormModal, OptionPicker } from './common/forms';
import { formatDateTime, relativeTime, severityVariant, titleCase } from './common/format';
import { useAsync, useErrorToast } from './common/hooks';
import { ActionButton, EmptyState, ErrorView, LoadingView, Restricted, ScreenHeader, Segmented, StatGrid } from './common/layout';

interface SecurityAlertsScreenNewProps {
  navigation: any;
}

type StatusFilter = 'unreviewed' | 'reviewed' | 'all';
type SeverityFilter = 'all' | 'medium' | 'high' | 'critical';

/** Security alerts derived from the audit log (lockouts, break-glass access, permission changes…). */
export function SecurityAlertsScreenNew({ navigation }: SecurityAlertsScreenNewProps) {
  const { can } = useAuth();
  const [status, setStatus] = useState<StatusFilter>('unreviewed');
  const [severity, setSeverity] = useState<SeverityFilter>('all');
  const [search, setSearch] = useState('');
  const [reviewing, setReviewing] = useState<SecurityAlert | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const allowed = can(P.SECURITY_READ);

  const { data, loading, error, reload } = useAsync(
    async () => (await securityAPI.alerts({ status, severity: severity === 'all' ? undefined : severity })).data,
    [status, severity, refreshKey],
    { enabled: allowed },
  );

  const alerts = useMemo(
    () =>
      (data ?? []).filter((alert) => {
        if (!search) return true;
        const term = search.toLowerCase();
        return (
          alert.title.toLowerCase().includes(term) ||
          (alert.actor ?? '').toLowerCase().includes(term) ||
          (alert.actor_name ?? '').toLowerCase().includes(term) ||
          (alert.patient_name ?? '').toLowerCase().includes(term)
        );
      }),
    [data, search],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Security Alerts" subtitle="Events that need an administrator's attention" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={false} onRefresh={() => setRefreshKey((k) => k + 1)} />}>
        {!allowed ? <Restricted /> : null}
        {allowed ? (
          <>
            <StatGrid
              items={[
                { label: 'Critical', value: (data ?? []).filter((a) => a.severity === 'critical').length, color: '#dc2626' },
                { label: 'High', value: (data ?? []).filter((a) => a.severity === 'high').length, color: '#ea580c' },
                { label: 'Medium', value: (data ?? []).filter((a) => a.severity === 'medium').length, color: '#d97706' },
              ]}
            />
            <TextInput style={styles.search} value={search} onChangeText={setSearch} placeholder="🔍  Search alert, user or patient…" placeholderTextColor="#94a3b8" />
            <Segmented
              value={status}
              onChange={setStatus}
              options={[
                { value: 'unreviewed', label: 'Needs review' },
                { value: 'reviewed', label: 'Reviewed' },
                { value: 'all', label: 'All' },
              ]}
            />
            <Segmented
              value={severity}
              onChange={setSeverity}
              options={[
                { value: 'all', label: 'Any severity' },
                { value: 'critical', label: 'Critical' },
                { value: 'high', label: 'High' },
                { value: 'medium', label: 'Medium' },
              ]}
            />
          </>
        ) : null}
        {loading && !data ? <LoadingView /> : null}
        {error ? <ErrorView message={error.message} onRetry={reload} /> : null}
        {data && alerts.length === 0 ? <EmptyState icon="✅" message="No security alerts in this view" /> : null}

        <View style={styles.list}>
          {alerts.map((alert) => (
            <Card key={alert.id} style={alert.severity === 'critical' ? styles.criticalCard : undefined}>
              <CardContent style={styles.itemContent}>
                <View style={styles.rowBetween}>
                  <Text style={styles.title}>{alert.title}</Text>
                  <Badge variant={severityVariant(alert.severity)}>{titleCase(alert.severity)}</Badge>
                </View>
                <Text style={styles.meta}>
                  {formatDateTime(alert.ts)} ({relativeTime(alert.ts)}) · IP {alert.ip ?? 'unknown'}
                </Text>
                <Text style={styles.body}>
                  👤 {alert.actor_name ?? alert.actor ?? 'Unknown user'}
                  {alert.actor_role ? ` (${titleCase(alert.actor_role)})` : ''}
                  {alert.patient_name ? ` · patient ${alert.patient_name}` : ''} · outcome {alert.outcome}
                </Text>
                {alert.details ? (
                  <Text style={styles.meta}>
                    {Object.entries(alert.details)
                      .map(([key, value]) => `${titleCase(key)}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
                      .join(' · ')}
                  </Text>
                ) : null}
                {alert.status === 'reviewed' ? (
                  <View style={styles.reviewBox}>
                    <Text style={styles.reviewText}>
                      ✓ {titleCase(alert.resolution)} by {alert.reviewed_by_name ?? 'admin'} {relativeTime(alert.reviewed_at)}
                    </Text>
                    {alert.review_notes ? <Text style={styles.reviewNotes}>{alert.review_notes}</Text> : null}
                  </View>
                ) : (
                  <View style={styles.actions}>
                    <ActionButton label="Review" small onPress={() => setReviewing(alert)} />
                  </View>
                )}
              </CardContent>
            </Card>
          ))}
        </View>
      </ScrollView>
      <ReviewModal alert={reviewing} onClose={() => setReviewing(null)} onSaved={reload} />
    </SafeAreaView>
  );
}

function ReviewModal({ alert, onClose, onSaved }: { alert: SecurityAlert | null; onClose: () => void; onSaved: () => void }) {
  const { showToast } = useToast();
  const showError = useErrorToast();
  const [resolution, setResolution] = useState('resolved');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await securityAPI.review(alert!.id, resolution, notes.trim() || undefined);
      showToast('Alert reviewed', 'success');
      setNotes('');
      onSaved();
      onClose();
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormModal visible={Boolean(alert)} title="Review security alert" subtitle={alert?.title} onClose={onClose} onSubmit={submit} submitting={busy} submitLabel="Save review">
      <OptionPicker
        label="Resolution"
        options={[
          { value: 'resolved', label: 'Resolved' },
          { value: 'false_positive', label: 'False positive' },
          { value: 'escalated', label: 'Escalated' },
        ]}
        value={resolution}
        onChange={setResolution}
      />
      <Field label="Notes" value={notes} onChangeText={setNotes} multiline placeholder="What was checked / what action was taken" maxLength={500} />
    </FormModal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 16, paddingBottom: 40, maxWidth: 900, width: '100%', alignSelf: 'center' },
  search: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, backgroundColor: '#fff', marginBottom: 12, color: '#0f172a' },
  list: { gap: 12 },
  criticalCard: { borderColor: '#fecaca', borderWidth: 2 },
  itemContent: { paddingVertical: 14 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  title: { fontSize: 15, fontWeight: '700', color: '#0f172a', flex: 1 },
  meta: { fontSize: 12, color: '#64748b', marginTop: 4 },
  body: { fontSize: 14, color: '#334155', marginTop: 8 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  reviewBox: { marginTop: 10, padding: 10, borderRadius: 8, backgroundColor: '#f0fdf4' },
  reviewText: { fontSize: 13, color: '#166534', fontWeight: '600' },
  reviewNotes: { fontSize: 13, color: '#166534', marginTop: 4 },
});
