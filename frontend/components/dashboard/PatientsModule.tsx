import React, { useMemo, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { P } from '../../constants/permissions';
import { useAuth } from '../../context/AuthContext';
import { Patient, patientAPI } from '../../services/api';
import { cachePatients } from '../../services/offlineCache';
import { formatDate, formatDateTime, priorityVariant, statusVariant, titleCase } from '../common/format';
import { useAsync } from '../common/hooks';
import { ActionButton, EmptyState, ErrorView, LoadingView, SectionHeader, Segmented } from '../common/layout';
import { Badge, Card, CardContent, Progress } from '../ui';
import { PatientFormModal } from './PatientFormModal';
import { moduleStyles as s } from './styles';

export interface ModuleProps {
    navigation: any;
    refreshKey: number;
}

type Filter = 'all' | 'active' | 'critical' | 'discharged';

export function PatientsModule({ navigation, refreshKey }: ModuleProps) {
    const { can, user } = useAuth();
    const seesAll = can(P.PATIENTS_READ_ALL);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState<Filter>('all');
    const [formVisible, setFormVisible] = useState(false);
    const { data, loading, error, reload } = useAsync(async () => {
        const { data: patients } = await patientAPI.getAll();
        cachePatients(patients);
        return patients;
    }, [refreshKey]);

    const patients = useMemo(
        () =>
            (data ?? []).filter((patient) => {
                if (filter !== 'all' && patient.status !== filter) return false;
                if (!search) return true;
                const term = search.toLowerCase();
                return (
                    patient.full_name.toLowerCase().includes(term) ||
                    patient.mrn.toLowerCase().includes(term) ||
                    (patient.primary_diagnosis ?? '').toLowerCase().includes(term)
                );
            }),
        [data, search, filter],
    );

    return (
        <View>
            <SectionHeader
                title={seesAll ? 'Patient Records' : 'My Patients'}
                subtitle={data ? `${data.length} patient(s)${seesAll ? '' : ' on your care team'}` : undefined}
                action={can(P.PATIENTS_CREATE) ? <ActionButton label="+ New Patient" onPress={() => setFormVisible(true)} small /> : null}
            />
            <TextInput style={s.search} value={search} onChangeText={setSearch} placeholder="🔍  Search name, MRN or diagnosis…" placeholderTextColor="#94a3b8" />
            <Segmented
                value={filter}
                onChange={setFilter}
                options={[
                    { value: 'all', label: 'All' },
                    { value: 'active', label: 'Active' },
                    { value: 'critical', label: 'Critical' },
                    { value: 'discharged', label: 'Discharged' },
                ]}
            />

            {loading && !data ? <LoadingView /> : null}
            {error ? (
                <ErrorView
                    message={error.message}
                    onRetry={error.code === 'NETWORK_ERROR' ? () => navigation.navigate('OfflineModeNew') : reload}
                    retryLabel={error.code === 'NETWORK_ERROR' ? 'Open offline mode' : 'Try again'}
                />
            ) : null}
            {user?.view_as ? (
                <Text style={{ color: '#64748b', fontSize: 12, marginBottom: 10 }}>
                    Preview: showing the care-team patients of {user.view_as.name}, the demo {user.role_name} account.
                </Text>
            ) : null}
            {data && data.length === 0 ? (
                <EmptyState
                    icon="🩺"
                    message={
                        seesAll
                            ? 'No patients registered yet'
                            : 'No patients are assigned to you yet. A patient appears here when you are their attending physician, therapist/psychologist or care-team member, or when they book an appointment with you.'
                    }
                />
            ) : data && patients.length === 0 ? (
                <EmptyState message="No patients match your search" />
            ) : null}

            <View style={s.list}>
                {patients.map((patient) => (
                    <PatientCard key={patient.id} patient={patient} onPress={() => navigation.navigate('PatientProfileNew', { patientId: patient.id })} />
                ))}
            </View>

            <PatientFormModal visible={formVisible} patient={null} onClose={() => setFormVisible(false)} onSaved={() => reload()} />
        </View>
    );
}

export function PatientCard({ patient, onPress }: { patient: Patient; onPress: () => void }) {
    return (
        <TouchableOpacity onPress={onPress} activeOpacity={0.75}>
            <Card>
                <CardContent style={s.itemContent}>
                    <View style={s.rowBetween}>
                        <View style={{ flex: 1 }}>
                            <Text style={s.title}>{patient.full_name}</Text>
                            <Text style={s.subtitle}>
                                {patient.mrn}
                                {patient.age !== null ? ` · ${patient.age} yrs` : ''}
                                {patient.gender ? ` · ${patient.gender}` : ''}
                            </Text>
                        </View>
                        <View style={s.badges}>
                            <Badge variant={statusVariant(patient.status)}>{titleCase(patient.status)}</Badge>
                            <Badge variant={priorityVariant(patient.priority)}>{titleCase(patient.priority)}</Badge>
                        </View>
                    </View>
                    <View style={s.grid}>
                        <View style={s.gridItem}>
                            <Text style={s.gridLabel}>Diagnosis</Text>
                            <Text style={s.gridValue}>{patient.primary_diagnosis ?? '—'}</Text>
                        </View>
                        <View style={s.gridItem}>
                            <Text style={s.gridLabel}>Ward / Room</Text>
                            <Text style={s.gridValue}>{patient.ward ? `${patient.ward}${patient.room ? ` · ${patient.room}` : ''}` : 'Outpatient'}</Text>
                        </View>
                        {patient.next_appointment_at !== undefined ? (
                            <View style={s.gridItem}>
                                <Text style={s.gridLabel}>Next appointment</Text>
                                <Text style={s.gridValue}>{patient.next_appointment_at ? formatDateTime(patient.next_appointment_at) : 'None'}</Text>
                            </View>
                        ) : null}
                        {patient.last_session_date !== undefined ? (
                            <View style={s.gridItem}>
                                <Text style={s.gridLabel}>Last session</Text>
                                <Text style={s.gridValue}>{formatDate(patient.last_session_date)}</Text>
                            </View>
                        ) : null}
                    </View>
                    {patient.latest_progress !== undefined && patient.latest_progress !== null ? (
                        <View style={s.progressRow}>
                            <View style={s.progressLabelRow}>
                                <Text style={s.progressLabel}>Treatment progress</Text>
                                <Text style={s.progressValue}>{patient.latest_progress}%</Text>
                            </View>
                            <Progress value={patient.latest_progress} />
                        </View>
                    ) : null}
                    <Text style={s.meta}>
                        {[
                            patient.attending_physician_name ? `Doctor: ${patient.attending_physician_name}` : null,
                            patient.assigned_therapist_name ? `Therapist: ${patient.assigned_therapist_name}` : null,
                        ]
                            .filter(Boolean)
                            .join(' · ') || 'No lead clinician assigned'}
                    </Text>
                </CardContent>
            </Card>
        </TouchableOpacity>
    );
}
