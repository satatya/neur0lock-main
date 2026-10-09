import React, { useMemo, useState } from 'react';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TextInputProps,
    TouchableOpacity,
    View,
} from 'react-native';
import { Patient, patientAPI, staffAPI } from '../../services/api';
import { useAsync } from './hooks';
import { colors } from './layout';
import { MODAL_ANIMATION_SLIDE } from './modal';

export function FormModal({
    visible,
    title,
    subtitle,
    onClose,
    onSubmit,
    submitLabel = 'Save',
    submitting,
    submitDisabled,
    destructive,
    error,
    children,
}: {
    visible: boolean;
    title: string;
    subtitle?: string;
    onClose: () => void;
    onSubmit?: () => void;
    submitLabel?: string;
    submitting?: boolean;
    submitDisabled?: boolean;
    destructive?: boolean;
    error?: string | null;
    children: React.ReactNode;
}) {
    return (
        <Modal visible={visible} transparent animationType={MODAL_ANIMATION_SLIDE} onRequestClose={onClose}>
            <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                <View style={styles.sheet}>
                    <View style={styles.sheetHeader}>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.sheetTitle}>{title}</Text>
                            {subtitle ? <Text style={styles.sheetSubtitle}>{subtitle}</Text> : null}
                        </View>
                        <TouchableOpacity onPress={onClose} style={styles.close} accessibilityLabel="Close">
                            <Text style={styles.closeText}>✕</Text>
                        </TouchableOpacity>
                    </View>
                    <ScrollView style={styles.sheetBody} contentContainerStyle={{ paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
                        {children}
                        {error ? <Text style={styles.error}>{error}</Text> : null}
                    </ScrollView>
                    {onSubmit ? (
                        <View style={styles.sheetFooter}>
                            <TouchableOpacity style={[styles.footerButton, styles.cancelButton]} onPress={onClose} disabled={submitting}>
                                <Text style={styles.cancelText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.footerButton, destructive ? styles.dangerButton : styles.submitButton, (submitDisabled || submitting) && styles.disabled]}
                                onPress={onSubmit}
                                disabled={submitDisabled || submitting}
                            >
                                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>{submitLabel}</Text>}
                            </TouchableOpacity>
                        </View>
                    ) : null}
                </View>
            </KeyboardAvoidingView>
        </Modal>
    );
}

export function Field({ label, hint, required, ...props }: TextInputProps & { label: string; hint?: string; required?: boolean }) {
    return (
        <View style={styles.field}>
            <Text style={styles.label}>
                {label}
                {required ? <Text style={{ color: colors.danger }}> *</Text> : null}
            </Text>
            <TextInput
                placeholderTextColor={colors.subtle}
                {...props}
                style={[styles.input, props.multiline && styles.multiline, props.editable === false && styles.inputDisabled, props.style]}
            />
            {hint ? <Text style={styles.hint}>{hint}</Text> : null}
        </View>
    );
}

export function OptionPicker<T extends string>({
    label,
    options,
    value,
    onChange,
    required,
}: {
    label: string;
    options: { value: T; label: string }[] | readonly T[];
    value: T | '' | null | undefined;
    onChange: (value: T) => void;
    required?: boolean;
}) {
    const normalized = (options as any[]).map((option) => (typeof option === 'string' ? { value: option, label: option } : option)) as {
        value: T;
        label: string;
    }[];
    return (
        <View style={styles.field}>
            <Text style={styles.label}>
                {label}
                {required ? <Text style={{ color: colors.danger }}> *</Text> : null}
            </Text>
            <View style={styles.chips}>
                {normalized.map((option) => (
                    <TouchableOpacity
                        key={option.value}
                        onPress={() => onChange(option.value)}
                        style={[styles.chip, value === option.value && styles.chipActive]}
                        activeOpacity={0.75}
                    >
                        <Text style={[styles.chipText, value === option.value && styles.chipTextActive]}>{option.label}</Text>
                    </TouchableOpacity>
                ))}
            </View>
        </View>
    );
}

/** Searchable patient selector backed by the patients API (respects the caller's permissions). */
export function PatientPicker({
    value,
    onChange,
    label = 'Patient',
    patients: provided,
}: {
    value: number | null;
    onChange: (patient: Patient) => void;
    label?: string;
    patients?: Patient[];
}) {
    const [search, setSearch] = useState('');
    const fetched = useAsync(async () => (await patientAPI.getAll()).data, [], { enabled: !provided });
    const data = provided ?? fetched.data;
    const loading = !provided && fetched.loading;
    const filtered = useMemo(
        () =>
            (data ?? []).filter(
                (patient) => !search || patient.full_name.toLowerCase().includes(search.toLowerCase()) || patient.mrn.toLowerCase().includes(search.toLowerCase()),
            ),
        [data, search],
    );
    return (
        <View style={styles.field}>
            <Text style={styles.label}>
                {label}
                <Text style={{ color: colors.danger }}> *</Text>
            </Text>
            <TextInput style={styles.input} value={search} onChangeText={setSearch} placeholder="Search name or MRN…" placeholderTextColor={colors.subtle} />
            <ScrollView style={styles.pickerList} nestedScrollEnabled>
                {loading ? <ActivityIndicator style={{ margin: 12 }} color={colors.primary} /> : null}
                {filtered.map((patient) => (
                    <TouchableOpacity
                        key={patient.id}
                        style={[styles.pickerItem, value === patient.id && styles.pickerItemActive]}
                        onPress={() => onChange(patient)}
                    >
                        <Text style={[styles.pickerText, value === patient.id && styles.pickerTextActive]}>
                            {patient.full_name} · {patient.mrn}
                        </Text>
                    </TouchableOpacity>
                ))}
                {!loading && filtered.length === 0 ? <Text style={styles.hint}>No matching patients</Text> : null}
            </ScrollView>
        </View>
    );
}

/** Active clinicians (optionally filtered by role) for care-team and appointment pickers. */
export function StaffPicker({
    label,
    value,
    onChange,
    roles,
    allowNone,
}: {
    label: string;
    value: number | null;
    onChange: (id: number | null) => void;
    roles?: string[];
    allowNone?: boolean;
}) {
    const { data } = useAsync(async () => (await staffAPI.directory()).data, []);
    const staff = (data ?? []).filter((member) => !roles || roles.includes(member.role));
    return (
        <View style={styles.field}>
            <Text style={styles.label}>{label}</Text>
            <View style={styles.chips}>
                {allowNone ? (
                    <TouchableOpacity onPress={() => onChange(null)} style={[styles.chip, value === null && styles.chipActive]}>
                        <Text style={[styles.chipText, value === null && styles.chipTextActive]}>None</Text>
                    </TouchableOpacity>
                ) : null}
                {staff.map((member) => (
                    <TouchableOpacity key={member.id} onPress={() => onChange(member.id)} style={[styles.chip, value === member.id && styles.chipActive]}>
                        <Text style={[styles.chipText, value === member.id && styles.chipTextActive]}>
                            {member.name} ({member.role_name})
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>
        </View>
    );
}

/** Multi-select of active staff (any role), e.g. a patient's care team. */
export function StaffMultiPicker({
    label,
    hint,
    value,
    onChange,
    exclude = [],
}: {
    label: string;
    hint?: string;
    value: number[];
    onChange: (ids: number[]) => void;
    /** Staff already covered elsewhere (e.g. the attending physician), hidden from the list. */
    exclude?: (number | null)[];
}) {
    const { data, loading } = useAsync(async () => (await staffAPI.directory()).data, []);
    const staff = (data ?? []).filter((member) => !exclude.includes(member.id));
    const toggle = (id: number) => onChange(value.includes(id) ? value.filter((item) => item !== id) : [...value, id]);
    return (
        <View style={styles.field}>
            <Text style={styles.label}>{label}</Text>
            {loading ? <ActivityIndicator color={colors.primary} style={{ alignSelf: 'flex-start' }} /> : null}
            <View style={styles.chips}>
                {staff.map((member) => {
                    const selected = value.includes(member.id);
                    return (
                        <TouchableOpacity key={member.id} onPress={() => toggle(member.id)} style={[styles.chip, selected && styles.chipActive]}>
                            <Text style={[styles.chipText, selected && styles.chipTextActive]}>
                                {selected ? '✓ ' : ''}
                                {member.name} ({member.role_name})
                            </Text>
                        </TouchableOpacity>
                    );
                })}
            </View>
            {hint ? <Text style={styles.hint}>{hint}</Text> : null}
        </View>
    );
}

export function Row({ children }: { children: React.ReactNode }) {
    return <View style={styles.row}>{children}</View>;
}

export function Col({ children }: { children: React.ReactNode }) {
    return <View style={{ flex: 1 }}>{children}</View>;
}

const styles = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.5)', justifyContent: 'flex-end', alignItems: 'center' },
    sheet: {
        width: '100%',
        maxWidth: 640,
        maxHeight: '92%',
        backgroundColor: '#fff',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        ...(Platform.OS === 'web' ? { borderBottomLeftRadius: 20, borderBottomRightRadius: 20, marginBottom: 24 } : null),
    },
    sheetHeader: { flexDirection: 'row', alignItems: 'center', padding: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
    sheetTitle: { fontSize: 19, fontWeight: '700', color: colors.text },
    sheetSubtitle: { fontSize: 13, color: colors.muted, marginTop: 2 },
    close: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f5f9' },
    closeText: { fontSize: 16, color: colors.muted },
    sheetBody: { paddingHorizontal: 20, paddingTop: 16 },
    sheetFooter: { flexDirection: 'row', gap: 12, padding: 16, borderTopWidth: 1, borderTopColor: colors.border },
    footerButton: { flex: 1, paddingVertical: 13, borderRadius: 10, alignItems: 'center' },
    cancelButton: { backgroundColor: '#f1f5f9' },
    cancelText: { color: '#334155', fontWeight: '600' },
    submitButton: { backgroundColor: colors.primary },
    dangerButton: { backgroundColor: colors.danger },
    submitText: { color: '#fff', fontWeight: '600' },
    disabled: { opacity: 0.5 },
    error: { color: colors.danger, marginTop: 8 },
    field: { marginBottom: 14 },
    label: { fontSize: 13, fontWeight: '600', color: '#334155', marginBottom: 6 },
    input: {
        borderWidth: 1,
        borderColor: '#cbd5e1',
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: Platform.OS === 'web' ? 10 : 9,
        fontSize: 15,
        color: colors.text,
        backgroundColor: '#fff',
    },
    inputDisabled: { backgroundColor: '#f1f5f9', color: colors.muted },
    multiline: { minHeight: 90, textAlignVertical: 'top' },
    hint: { fontSize: 12, color: colors.subtle, marginTop: 4 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: '#f8fafc' },
    chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { fontSize: 13, color: '#334155' },
    chipTextActive: { color: '#fff', fontWeight: '600' },
    pickerList: { maxHeight: 170, marginTop: 6, borderWidth: 1, borderColor: colors.border, borderRadius: 8 },
    pickerItem: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
    pickerItemActive: { backgroundColor: '#dbeafe' },
    pickerText: { fontSize: 14, color: colors.text },
    pickerTextActive: { fontWeight: '700', color: colors.primaryDark },
    row: { flexDirection: 'row', gap: 12 },
});
