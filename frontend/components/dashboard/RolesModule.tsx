import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { useStepUp } from '../../context/StepUpContext';
import { PermissionDefinition, Role, roleAPI } from '../../services/api';
import { useDialog } from '../common/dialogs';
import { Field, FormModal, OptionPicker } from '../common/forms';
import { useAsync, useErrorToast } from '../common/hooks';
import { ActionButton, ErrorView, LoadingView, SectionHeader } from '../common/layout';
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, useToast } from '../ui';
import { ModuleProps } from './PatientsModule';
import { moduleStyles as s } from './styles';

/**
 * Live role-permission editor. Roles and grants live in the directory (LDAP) behind the AAA server;
 * every toggle is saved immediately and applies to everyone in that role on their next request.
 */
export function RolesModule({ refreshKey }: ModuleProps) {
    const { withStepUp } = useStepUp();
    const { confirm } = useDialog();
    const { showToast } = useToast();
    const showError = useErrorToast();
    const { user, refresh } = useAuth();
    const [selectedName, setSelectedName] = useState<string | null>(null);
    const [pending, setPending] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);

    const { data, loading, error, reload, setData } = useAsync(async () => {
        const [roles, catalog] = await Promise.all([roleAPI.getAll(), roleAPI.permissions()]);
        return { roles: roles.data, catalog: catalog.data };
    }, [refreshKey]);

    const roles = data?.roles ?? [];
    const selected = roles.find((role) => role.name === selectedName) ?? roles[0];
    const ownRole = user?.base_role;
    const categories = useMemo(() => {
        const groups: Record<string, PermissionDefinition[]> = {};
        for (const permission of data?.catalog ?? []) {
            (groups[permission.category] = groups[permission.category] ?? []).push(permission);
        }
        return Object.entries(groups);
    }, [data?.catalog]);

    const replaceRole = (updated: Role) => setData((current) => current && { ...current, roles: current.roles.map((role) => (role.name === updated.name ? updated : role)) });

    const toggle = async (role: Role, code: string, granted: boolean) => {
        setPending(code);
        try {
            const { data: updated } = await withStepUp(
                () => roleAPI.setPermission(role.name, code, granted),
                'Changing role permissions affects every user in that role. Re-enter your password to continue.',
            );
            replaceRole(updated);
            showToast(`${granted ? 'Granted' : 'Revoked'} "${code}" ${granted ? 'to' : 'from'} ${role.display_name}`, 'success');
            if (role.name === ownRole || role.name === user?.role) await refresh();
        } catch (e) {
            showError(e);
        } finally {
            setPending(null);
        }
    };

    const setCategory = async (role: Role, permissions: PermissionDefinition[], grant: boolean) => {
        const codes = permissions.map((p) => p.code);
        const next = grant ? [...new Set([...role.permissions, ...codes])] : role.permissions.filter((code) => !codes.includes(code));
        setPending(codes[0]);
        try {
            const { data: updated } = await withStepUp(() => roleAPI.update(role.name, { permissions: next }), 'Changing role permissions requires re-authentication.');
            replaceRole(updated);
            showToast(`${role.display_name} updated`, 'success');
            if (role.name === ownRole || role.name === user?.role) await refresh();
        } catch (e) {
            showError(e);
        } finally {
            setPending(null);
        }
    };

    const setSignup = async (role: Role, changes: { signup?: boolean; requires_approval?: boolean }) => {
        setPending('__signup');
        try {
            const { data: updated } = await withStepUp(() => roleAPI.update(role.name, changes), 'Changing who can sign up requires re-authentication.');
            replaceRole(updated);
            showToast(`${role.display_name} sign-up settings saved`, 'success');
        } catch (e) {
            showError(e);
        } finally {
            setPending(null);
        }
    };

    const removeRole = async (role: Role) => {
        if (!(await confirm({ title: `Delete role "${role.display_name}"?`, confirmText: 'Delete role', destructive: true }))) return;
        try {
            await withStepUp(() => roleAPI.delete(role.name));
            showToast('Role deleted', 'success');
            setSelectedName(null);
            reload();
        } catch (e) {
            showError(e);
        }
    };

    if (loading && !data) return <LoadingView />;
    if (error) return <ErrorView message={error.message} onRetry={reload} />;

    return (
        <View>
            <SectionHeader title="Roles & permissions" action={<ActionButton label="+ New role" small onPress={() => setCreating(true)} />} />
            <Alert
                variant="default"
                title="Changes apply immediately"
                description="Toggling a permission updates access for everyone in that role on their next action. Editing requires re-authentication, is audited, and the system prevents removing the last administrator."
                style={s.notice}
            />

            <Card style={{ marginBottom: 12 }}>
                <CardHeader>
                    <CardTitle>Permission matrix</CardTitle>
                </CardHeader>
                <CardContent>
                    {roles.map((role) => (
                        <TouchableOpacity
                            key={role.name}
                            onPress={() => setSelectedName(role.name)}
                            style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}
                        >
                            <View style={s.rowBetween}>
                                <Text style={[s.title, { fontSize: 14 }, selected?.name === role.name && { color: '#2563eb' }]}>
                                    {selected?.name === role.name ? '▸ ' : ''}
                                    {role.display_name}
                                </Text>
                                <Text style={s.meta}>
                                    {role.permissions.length}/{data?.catalog.length ?? 0} · {role.staff_count} {role.is_patient ? 'patients' : 'staff'}
                                    {role.signup ? ' · sign-up' : ''}
                                </Text>
                            </View>
                            <View style={[s.badges, { marginTop: 6 }]}>
                                {categories.map(([category, permissions]) => {
                                    const granted = permissions.filter((p) => role.permissions.includes(p.code)).length;
                                    return (
                                        <Badge key={category} variant={granted === 0 ? 'outline' : granted === permissions.length ? 'success' : 'secondary'}>
                                            {category} {granted}/{permissions.length}
                                        </Badge>
                                    );
                                })}
                            </View>
                        </TouchableOpacity>
                    ))}
                </CardContent>
            </Card>

            {selected ? (
                <Card>
                    <CardHeader>
                        <View style={s.rowBetween}>
                            <View style={{ flex: 1 }}>
                                <CardTitle>{selected.display_name}</CardTitle>
                                <Text style={s.subtitle}>{selected.description ?? 'No description'}</Text>
                                <Text style={s.meta}>
                                    {selected.staff_count} account(s) · {selected.is_system ? 'Built-in role' : 'Custom role'} · <Text style={{ fontFamily: 'monospace' }}>{selected.name}</Text>
                                    {selected.name === ownRole ? ' · your role' : ''}
                                </Text>
                            </View>
                            {!selected.is_system ? <ActionButton label="Delete" small variant="danger" onPress={() => removeRole(selected)} /> : null}
                        </View>
                    </CardHeader>
                    <CardContent>
                        <View style={{ marginBottom: 16, padding: 12, borderRadius: 10, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0' }}>
                            <Text style={[s.title, { fontSize: 14, color: '#475569' }]}>Self sign-up</Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 12 }}>
                                <View style={{ flex: 1 }}>
                                    <Text style={{ fontSize: 14, color: '#0f172a', fontWeight: '500' }}>Offer this role on the sign-up form</Text>
                                    <Text style={s.meta}>New users can pick it when creating an account.</Text>
                                </View>
                                {pending === '__signup' ? (
                                    <ActivityIndicator color="#3b82f6" />
                                ) : (
                                    <Switch
                                        value={selected.signup}
                                        onValueChange={(value) => setSignup(selected, selected.is_patient ? { signup: value } : { signup: value, requires_approval: true })}
                                        disabled={Boolean(pending) || selected.permissions.includes('roles:manage') || selected.permissions.includes('staff:manage')}
                                        trackColor={{ false: '#cbd5e1', true: '#3b82f6' }}
                                        thumbColor="#ffffff"
                                    />
                                )}
                            </View>
                            <Text style={s.meta}>
                                {selected.permissions.includes('roles:manage') || selected.permissions.includes('staff:manage')
                                    ? 'Roles that can manage staff or roles are never offered at sign-up.'
                                    : selected.is_patient
                                      ? 'Patient accounts are active immediately after sign-up and see only their own record.'
                                      : 'Staff sign-ups always wait for an administrator to approve them (Staff → Sign-up approvals).'}
                            </Text>
                        </View>
                        {categories.map(([category, permissions]) => {
                            const allGranted = permissions.every((p) => selected.permissions.includes(p.code));
                            return (
                                <View key={category} style={{ marginBottom: 16 }}>
                                    <View style={s.rowBetween}>
                                        <Text style={[s.title, { fontSize: 14, color: '#475569' }]}>{category}</Text>
                                        <TouchableOpacity onPress={() => setCategory(selected, permissions, !allGranted)} disabled={Boolean(pending)}>
                                            <Text style={{ color: '#2563eb', fontSize: 12, fontWeight: '600' }}>{allGranted ? 'Revoke all' : 'Grant all'}</Text>
                                        </TouchableOpacity>
                                    </View>
                                    {permissions.map((permission) => {
                                        const granted = selected.permissions.includes(permission.code);
                                        return (
                                            <View
                                                key={permission.code}
                                                style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f1f5f9', gap: 12 }}
                                            >
                                                <View style={{ flex: 1 }}>
                                                    <Text style={{ fontSize: 14, color: '#0f172a', fontWeight: '500' }}>{permission.label}</Text>
                                                    <Text style={s.meta}>
                                                        {permission.description} · <Text style={{ fontFamily: 'monospace' }}>{permission.code}</Text>
                                                    </Text>
                                                </View>
                                                {pending === permission.code ? (
                                                    <ActivityIndicator color="#3b82f6" />
                                                ) : (
                                                    <Switch
                                                        value={granted}
                                                        onValueChange={(value) => toggle(selected, permission.code, value)}
                                                        disabled={Boolean(pending)}
                                                        trackColor={{ false: '#cbd5e1', true: '#3b82f6' }}
                                                        thumbColor="#ffffff"
                                                    />
                                                )}
                                            </View>
                                        );
                                    })}
                                </View>
                            );
                        })}
                    </CardContent>
                </Card>
            ) : null}

            <CreateRoleModal
                visible={creating}
                roles={roles}
                onClose={() => setCreating(false)}
                onCreated={(role) => {
                    reload();
                    setSelectedName(role.name);
                }}
            />
        </View>
    );
}

function CreateRoleModal({ visible, roles, onClose, onCreated }: { visible: boolean; roles: Role[]; onClose: () => void; onCreated: (role: Role) => void }) {
    const { withStepUp } = useStepUp();
    const { showToast } = useToast();
    const showError = useErrorToast();
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [template, setTemplate] = useState('none');
    const [signup, setSignup] = useState<'no' | 'yes'>('no');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async () => {
        if (!name.trim()) return setError('Enter a role name');
        const base = roles.find((role) => role.name === template);
        setSaving(true);
        setError(null);
        try {
            const { data } = await withStepUp(() =>
                roleAPI.create({
                    display_name: name.trim(),
                    description: description.trim() || undefined,
                    permissions: (base?.permissions ?? []).filter((code) => signup === 'no' || !['roles:manage', 'staff:manage'].includes(code)),
                    signup: signup === 'yes',
                    requires_approval: signup === 'yes' ? true : undefined,
                }),
            );
            showToast(`Role "${data.display_name}" created`, 'success');
            setName('');
            setDescription('');
            setTemplate('none');
            setSignup('no');
            onClose();
            onCreated(data);
        } catch (e: any) {
            if (e?.code === 'CONFLICT' || e?.code === 'VALIDATION_ERROR') setError(e.message);
            else showError(e);
        } finally {
            setSaving(false);
        }
    };

    return (
        <FormModal
            visible={visible}
            title="Create role"
            subtitle="Staff assigned to a custom role get a dashboard built from its permissions."
            onClose={onClose}
            onSubmit={submit}
            submitting={saving}
            submitLabel="Create role"
            error={error}
        >
            <Field label="Role name" required value={name} onChangeText={setName} placeholder="e.g. Social Worker" />
            <Field label="Description" value={description} onChangeText={setDescription} />
            <OptionPicker
                label="Start with permissions from"
                options={[{ value: 'none', label: 'No permissions' }, ...roles.filter((role) => !role.is_patient).map((role) => ({ value: role.name, label: role.display_name }))]}
                value={template}
                onChange={setTemplate}
            />
            <OptionPicker
                label="Self sign-up"
                options={[
                    { value: 'no', label: 'Accounts created by admins only' },
                    { value: 'yes', label: 'Offer on sign-up (admin approves)' },
                ]}
                value={signup}
                onChange={setSignup}
            />
        </FormModal>
    );
}
