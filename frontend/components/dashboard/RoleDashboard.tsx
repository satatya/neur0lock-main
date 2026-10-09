import React, { useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { P, roleTheme } from '../../constants/permissions';
import { useAuth } from '../../context/AuthContext';
import { useTabHistory } from '../common/back';
import { useDialog } from '../common/dialogs';
import { colors } from '../common/layout';
import { Alert } from '../ui';
import { AlertsModule } from './AlertsModule';
import { AppointmentsModule } from './AppointmentsModule';
import { AssessmentsModule } from './AssessmentsModule';
import { AuditModule } from './AuditModule';
import { MedicationsModule } from './MedicationsModule';
import { NotesModule } from './NotesModule';
import { ModuleProps, PatientsModule } from './PatientsModule';
import { ReportsModule } from './ReportsModule';
import { RolesModule } from './RolesModule';
import { SecurityModule } from './SecurityModule';
import { SessionsModule } from './SessionsModule';
import { StaffModule } from './StaffModule';
import { VitalsModule } from './VitalsModule';

interface ModuleDefinition {
    key: string;
    label: string;
    icon: string;
    /** The tab is shown only if the user's role grants this permission. */
    permission: string;
    component: React.ComponentType<ModuleProps>;
}

/** Every feature area and the permission that unlocks it. Tabs are derived from live permissions. */
const MODULES: ModuleDefinition[] = [
    { key: 'patients', label: 'Patients', icon: '👥', permission: P.PATIENTS_READ, component: PatientsModule },
    { key: 'medications', label: 'Medications', icon: '💊', permission: P.MEDICATIONS_READ, component: MedicationsModule },
    { key: 'vitals', label: 'Vitals', icon: '❤️', permission: P.VITALS_READ, component: VitalsModule },
    { key: 'alerts', label: 'Alerts', icon: '🔔', permission: P.ALERTS_READ, component: AlertsModule },
    { key: 'appointments', label: 'Appointments', icon: '📅', permission: P.APPOINTMENTS_READ, component: AppointmentsModule },
    { key: 'sessions', label: 'Sessions', icon: '🗒️', permission: P.SESSIONS_READ, component: SessionsModule },
    { key: 'notes', label: 'Notes', icon: '📄', permission: P.NOTES_READ, component: NotesModule },
    { key: 'assessments', label: 'Assessments', icon: '📋', permission: P.ASSESSMENTS_READ, component: AssessmentsModule },
    { key: 'reports', label: 'Reports', icon: '📊', permission: P.REPORTS_READ, component: ReportsModule },
    { key: 'staff', label: 'Staff', icon: '🧑‍⚕️', permission: P.STAFF_READ, component: StaffModule },
    { key: 'roles', label: 'Roles', icon: '🛂', permission: P.ROLES_MANAGE, component: RolesModule },
    { key: 'audit', label: 'Audit', icon: '🧾', permission: P.AUDIT_READ, component: AuditModule },
    { key: 'security', label: 'Security', icon: '🚨', permission: P.SECURITY_READ, component: SecurityModule },
];

/** Preferred tab order per role; anything else the role is granted is appended. */
const ROLE_ORDER: Record<string, string[]> = {
    psychiatrist: ['patients', 'appointments', 'notes', 'medications', 'assessments', 'sessions', 'vitals', 'alerts', 'reports'],
    psychologist: ['patients', 'notes', 'assessments', 'sessions', 'appointments', 'alerts', 'reports'],
    therapist: ['sessions', 'patients', 'notes', 'appointments', 'assessments', 'alerts'],
    nurse: ['medications', 'vitals', 'alerts', 'patients', 'appointments'],
    admin: ['staff', 'roles', 'audit', 'security', 'patients', 'appointments', 'reports'],
};

export function RoleDashboard({ navigation }: { navigation: any }) {
    const { user, can, logout, refresh, chooseRole } = useAuth();
    const { confirm } = useDialog();
    const [refreshKey, setRefreshKey] = useState(0);
    const [refreshing, setRefreshing] = useState(false);
    const theme = roleTheme(user?.role, user?.role_name);

    const modules = useMemo(() => {
        const allowed = MODULES.filter((module) => can(module.permission));
        const order = ROLE_ORDER[user?.role ?? ''] ?? [];
        return [...allowed].sort((a, b) => {
            const ia = order.indexOf(a.key);
            const ib = order.indexOf(b.key);
            return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        });
    }, [can, user?.role]);

    // Back button returns to the previously opened tab
    const [active, setActive, resetActive] = useTabHistory<string | undefined>(modules[0]?.key);
    // If an administrator revokes the permission behind the open tab, fall back to the first allowed one.
    useEffect(() => {
        if (!modules.some((module) => module.key === active)) resetActive(modules[0]?.key);
    }, [modules, active, resetActive]);

    const ActiveModule = modules.find((module) => module.key === active)?.component;

    const onRefresh = async () => {
        setRefreshing(true);
        try {
            await refresh();
        } catch {
            // handled by the session layer
        }
        setRefreshKey((key) => key + 1);
        setRefreshing(false);
    };

    const onLogout = async () => {
        if (await confirm({ title: 'Sign out?', message: 'You will need to sign in again to access patient records.', confirmText: 'Sign out' })) {
            await logout();
        }
    };

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <LinearGradient colors={theme.colors} style={styles.header} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
                <View style={styles.headerTop}>
                    <View style={styles.headerLeft}>
                        <Text style={styles.headerIcon}>{theme.icon}</Text>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.headerTitle} numberOfLines={1}>
                                {theme.title}
                            </Text>
                            <Text style={styles.headerSubtitle} numberOfLines={1}>
                                {user?.name} · {user?.acting_role ? `viewing as ${user.role_name}` : user?.role_name}
                            </Text>
                        </View>
                    </View>
                    <View style={styles.headerRight}>
                        {user?.can_act_as ? (
                            <TouchableOpacity onPress={chooseRole} style={styles.headerButton} accessibilityLabel="Switch role">
                                <Text style={styles.headerButtonText}>🔀</Text>
                            </TouchableOpacity>
                        ) : null}
                        <TouchableOpacity onPress={() => navigation.navigate('MyAccessNew')} style={styles.headerButton} accessibilityLabel="My access">
                            <Text style={styles.headerButtonText}>🛡️</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => navigation.navigate('SettingsNew')} style={styles.headerButton} accessibilityLabel="Settings">
                            <Text style={styles.headerButtonText}>⚙️</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={onLogout} style={styles.headerButton} accessibilityLabel="Sign out">
                            <Text style={styles.headerButtonText}>🚪</Text>
                        </TouchableOpacity>
                    </View>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
                    {modules.map((module) => (
                        <TouchableOpacity
                            key={module.key}
                            onPress={() => setActive(module.key)}
                            style={[styles.tab, active === module.key && styles.tabActive]}
                            activeOpacity={0.8}
                        >
                            <Text style={[styles.tabText, active === module.key && styles.tabTextActive]}>
                                {module.icon} {module.label}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            </LinearGradient>

            <ScrollView
                style={styles.body}
                contentContainerStyle={styles.bodyContent}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
                keyboardShouldPersistTaps="handled"
            >
                {modules.length === 0 ? (
                    <Alert
                        variant="warning"
                        title="No access assigned"
                        description="Your role currently has no permissions. Contact your administrator to have access granted."
                    />
                ) : null}
                {ActiveModule ? <ActiveModule key={active} navigation={navigation} refreshKey={refreshKey} /> : null}
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10 },
    headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
    headerIcon: { fontSize: 28 },
    headerTitle: { fontSize: 20, fontWeight: '700', color: '#fff' },
    headerSubtitle: { fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
    headerRight: { flexDirection: 'row', gap: 6 },
    headerButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
    headerButtonText: { fontSize: 17 },
    tabs: { flexDirection: 'row', gap: 8, paddingTop: 14 },
    tab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.15)' },
    tabActive: { backgroundColor: '#fff' },
    tabText: { fontSize: 13, fontWeight: '600', color: '#fff' },
    tabTextActive: { color: colors.text },
    body: { flex: 1 },
    bodyContent: { padding: 16, paddingBottom: 48, maxWidth: 1000, width: '100%', alignSelf: 'center' },
});
