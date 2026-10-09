import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, TextInput, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { P } from '../constants/permissions';
import { useAuth } from '../context/AuthContext';
import { ApiError, AuditEntry, auditAPI } from '../services/api';
import { useErrorToast } from './common/hooks';
import { ActionButton, EmptyState, ErrorView, LoadingView, Restricted, ScreenHeader, Segmented } from './common/layout';
import { shareText, toCsv } from './common/share';
import { AuditEntryCard } from './dashboard/AuditModule';

interface StaffActivityLogsScreenNewProps {
  navigation: any;
}

type AccessFilter = 'all' | 'views' | 'changes' | 'auth' | 'denied';

const FILTERS: Record<AccessFilter, Record<string, string | undefined>> = {
  all: {},
  views: { resource: 'patient' },
  changes: { min_severity: 'low' },
  auth: { resource: 'auth' },
  denied: { outcome: 'denied' },
};

const PAGE = 50;

/** Full, paginated audit trail of staff activity. */
export function StaffActivityLogsScreenNew({ navigation }: StaffActivityLogsScreenNewProps) {
  const { can } = useAuth();
  const showError = useErrorToast();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<AccessFilter>('all');
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const allowed = can(P.AUDIT_READ);

  const load = useCallback(
    async (offset: number) => {
      setLoading(true);
      setError(null);
      try {
        const response = await auditAPI.getAll({ q: query, limit: PAGE, offset, ...FILTERS[filter] });
        setEntries((current) => (offset === 0 ? response.data : [...current, ...response.data]));
        setTotal(Number(response.meta?.total ?? 0));
      } catch (e) {
        setError(e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', String(e)));
      } finally {
        setLoading(false);
      }
    },
    [query, filter],
  );

  useEffect(() => {
    if (allowed) void load(0);
  }, [allowed, load]);

  const exportCsv = async () => {
    try {
      const { data } = await auditAPI.getAll({ q: query, limit: 500, ...FILTERS[filter] });
      await shareText(
        `neurolock-activity-${new Date().toISOString().slice(0, 10)}.csv`,
        toCsv(data as unknown as Record<string, unknown>[], ['id', 'ts', 'actor', 'actor_uid', 'actor_role', 'action', 'resource', 'resource_id', 'patient_id', 'outcome', 'severity', 'ip', 'details']),
      );
    } catch (e) {
      showError(e);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title="Staff Activity Logs"
        subtitle={allowed ? `${total} matching entries` : undefined}
        onBack={() => navigation.goBack()}
        right={allowed ? <ActionButton label="📥 Export" small variant="secondary" onPress={exportCsv} /> : null}
      />
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={false} onRefresh={() => load(0)} />} keyboardShouldPersistTaps="handled">
        {!allowed ? <Restricted /> : null}
        {allowed ? (
          <>
            <TextInput
              style={styles.search}
              value={search}
              onChangeText={setSearch}
              onSubmitEditing={() => setQuery(search.trim())}
              onBlur={() => setQuery(search.trim())}
              placeholder="🔍  Search user, action or resource (press enter)…"
              placeholderTextColor="#94a3b8"
              returnKeyType="search"
            />
            <Segmented
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All activity' },
                { value: 'views', label: 'Patient records' },
                { value: 'auth', label: 'Sign-ins' },
                { value: 'changes', label: 'Notable events' },
                { value: 'denied', label: 'Access denied' },
              ]}
            />
          </>
        ) : null}
        {error ? <ErrorView message={error.message} onRetry={() => load(0)} /> : null}
        {allowed && !loading && entries.length === 0 && !error ? <EmptyState message="No activity matches" /> : null}
        <View style={styles.list}>
          {entries.map((entry) => (
            <AuditEntryCard key={entry.id} entry={entry} />
          ))}
        </View>
        {loading ? <LoadingView /> : null}
        {!loading && entries.length < total ? (
          <ActionButton label={`Load more (${total - entries.length} remaining)`} variant="secondary" onPress={() => load(entries.length)} style={{ marginTop: 16 }} />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 16, paddingBottom: 40, maxWidth: 900, width: '100%', alignSelf: 'center' },
  search: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, backgroundColor: '#fff', marginBottom: 12, color: '#0f172a' },
  list: { gap: 12 },
});
