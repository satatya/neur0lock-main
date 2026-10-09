import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { P } from '../../constants/permissions';
import { useAuth } from '../../context/AuthContext';
import { ApiError, Patient, patientAPI } from '../../services/api';
import { Col, Field, FormModal, OptionPicker, Row, StaffMultiPicker, StaffPicker } from '../common/forms';
import { isValidDateString, titleCase } from '../common/format';
import { useErrorToast } from '../common/hooks';
import { colors } from '../common/layout';
import { useToast } from '../ui';

const STATUSES = ['active', 'critical', 'inactive', 'discharged'] as const;
const PRIORITIES = ['low', 'medium', 'high'] as const;
const GENDERS = ['Female', 'Male', 'Non-binary', 'Other'] as const;

type FormState = Record<string, string>;

const EMPTY: FormState = {
    full_name: '',
    dob: '',
    gender: '',
    phone: '',
    email: '',
    address: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
    insurance: '',
    allergies: '',
    primary_diagnosis: '',
    secondary_diagnosis: '',
    ward: '',
    room: '',
    status: 'active',
    priority: 'medium',
    admission_date: '',
};

const SENSITIVE = ['dob', 'phone', 'email', 'address', 'emergency_contact_name', 'emergency_contact_phone', 'insurance'];

/** Create / edit patient form. Sensitive fields only appear for roles allowed to see them. */
export function PatientFormModal({
    visible,
    patient,
    onClose,
    onSaved,
}: {
    visible: boolean;
    /** Existing patient (loaded with sensitive fields when permitted) or null to create */
    patient: Patient | null;
    onClose: () => void;
    onSaved: (patient: Patient) => void;
}) {
    const { can, user } = useAuth();
    const { showToast } = useToast();
    const showError = useErrorToast();
    const [form, setForm] = useState<FormState>(EMPTY);
    const [attending, setAttending] = useState<number | null>(null);
    const [therapist, setTherapist] = useState<number | null>(null);
    const [careTeam, setCareTeam] = useState<number[]>([]);
    const [saving, setSaving] = useState(false);
    const seesAll = can(P.PATIENTS_READ_ALL);
    const [error, setError] = useState<string | null>(null);
    const canSensitive = can(P.PATIENTS_READ_SENSITIVE);

    useEffect(() => {
        if (!visible) return;
        setError(null);
        if (patient) {
            const next: FormState = { ...EMPTY };
            for (const key of Object.keys(EMPTY)) {
                const value = (patient as any)[key];
                next[key] = value === null || value === undefined ? '' : String(value);
            }
            setForm(next);
            setAttending(patient.attending_physician_id);
            setTherapist(patient.assigned_therapist_id);
            setCareTeam((patient.care_team ?? []).map((member) => member.id));
        } else {
            setForm(EMPTY);
            // A clinician registering a patient is pre-filled as their lead in their own role
            const self = !user?.acting_role ? user?.id ?? null : null;
            setAttending(self && user?.role === 'psychiatrist' ? self : null);
            setTherapist(self && (user?.role === 'psychologist' || user?.role === 'therapist') ? self : null);
            setCareTeam([]);
        }
    }, [visible, patient, user]);

    const set = (key: string) => (value: string) => setForm((current) => ({ ...current, [key]: value }));

    const submit = async () => {
        if (!form.full_name.trim()) return setError('Patient name is required');
        for (const key of ['dob', 'admission_date']) {
            if (form[key] && !isValidDateString(form[key])) return setError(`${titleCase(key)} must be a valid date (YYYY-MM-DD)`);
        }
        const payload: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(form)) {
            if (SENSITIVE.includes(key) && !canSensitive) continue;
            if (!patient && value === '') continue;
            payload[key] = value.trim() === '' ? null : value.trim();
        }
        payload.full_name = form.full_name.trim();
        payload.attending_physician_id = attending;
        payload.assigned_therapist_id = therapist;
        // Leads are stored on the patient; the care team holds everyone else who may see the record
        payload.care_team_ids = careTeam.filter((id) => id !== attending && id !== therapist);

        setSaving(true);
        setError(null);
        try {
            const { data } = patient ? await patientAPI.update(patient.id, payload) : await patientAPI.create(payload);
            showToast(patient ? 'Patient updated' : 'Patient registered', 'success');
            onSaved(data);
            onClose();
        } catch (e) {
            if (e instanceof ApiError && (e.code === 'VALIDATION_ERROR' || e.code === 'CONFLICT')) setError(e.message);
            else showError(e);
        } finally {
            setSaving(false);
        }
    };

    return (
        <FormModal
            visible={visible}
            title={patient ? 'Edit patient' : 'Register new patient'}
            subtitle={patient ? `${patient.full_name} · ${patient.mrn}` : 'A medical record number is assigned automatically'}
            onClose={onClose}
            onSubmit={submit}
            submitting={saving}
            submitLabel={patient ? 'Save changes' : 'Register patient'}
            error={error}
        >
            <Field label="Full name" required value={form.full_name} onChangeText={set('full_name')} placeholder="e.g. Riya Jain" />
            <OptionPicker label="Gender" options={GENDERS} value={form.gender as any} onChange={set('gender')} />
            {canSensitive ? (
                <>
                    <Row>
                        <Col>
                            <Field label="Date of birth" value={form.dob} onChangeText={set('dob')} placeholder="YYYY-MM-DD" />
                        </Col>
                        <Col>
                            <Field label="Phone" value={form.phone} onChangeText={set('phone')} keyboardType="phone-pad" />
                        </Col>
                    </Row>
                    <Field label="Email" value={form.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" />
                    <Field label="Address" value={form.address} onChangeText={set('address')} />
                    <Row>
                        <Col>
                            <Field label="Emergency contact" value={form.emergency_contact_name} onChangeText={set('emergency_contact_name')} />
                        </Col>
                        <Col>
                            <Field label="Emergency phone" value={form.emergency_contact_phone} onChangeText={set('emergency_contact_phone')} keyboardType="phone-pad" />
                        </Col>
                    </Row>
                    <Field label="Insurance" value={form.insurance} onChangeText={set('insurance')} />
                </>
            ) : (
                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 12 }}>
                    🔒 Contact details, date of birth and insurance are hidden for your role.
                </Text>
            )}
            <Field label="Primary diagnosis" value={form.primary_diagnosis} onChangeText={set('primary_diagnosis')} />
            <Field label="Secondary diagnosis" value={form.secondary_diagnosis} onChangeText={set('secondary_diagnosis')} />
            <Field label="Allergies" value={form.allergies} onChangeText={set('allergies')} />
            <Row>
                <Col>
                    <Field label="Ward" value={form.ward} onChangeText={set('ward')} placeholder="e.g. Ward A" />
                </Col>
                <Col>
                    <Field label="Room" value={form.room} onChangeText={set('room')} placeholder="e.g. A-101" />
                </Col>
            </Row>
            <Field label="Admission date" value={form.admission_date} onChangeText={set('admission_date')} placeholder="YYYY-MM-DD (leave empty for outpatients)" />
            <OptionPicker label="Status" options={STATUSES.map((s) => ({ value: s, label: titleCase(s) }))} value={form.status as any} onChange={set('status')} />
            <OptionPicker label="Priority" options={PRIORITIES.map((p) => ({ value: p, label: titleCase(p) }))} value={form.priority as any} onChange={set('priority')} />
            <StaffPicker label="Attending physician" value={attending} onChange={setAttending} roles={['psychiatrist']} allowNone />
            <StaffPicker label="Assigned therapist / psychologist" value={therapist} onChange={setTherapist} roles={['therapist', 'psychologist']} allowNone />
            <StaffMultiPicker
                label="Care team (other staff who may see this patient)"
                value={careTeam}
                onChange={setCareTeam}
                exclude={[attending, therapist]}
                hint={
                    seesAll
                        ? 'Only the attending physician, the assigned therapist/psychologist and these staff can see this patient.'
                        : patient
                          ? 'Only the leads above and these staff can see this patient. You cannot remove yourself.'
                          : 'Only the leads above and these staff can see this patient. You are added automatically.'
                }
            />
        </FormModal>
    );
}
