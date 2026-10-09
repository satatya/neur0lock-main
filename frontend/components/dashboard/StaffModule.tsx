import React, { useMemo, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { P } from '../../constants/permissions';
import { useAuth } from '../../context/AuthContext';
import { useStepUp } from '../../context/StepUpContext';
import { Account, Role, roleAPI, Signup, staffAPI } from '../../services/api';
import { useDialog } from '../common/dialogs';
import { Field, FormModal, OptionPicker } from '../common/forms';
import { formatDateTime, formatTime, relativeTime, statusVariant, titleCase } from '../common/format';
import { useAsync, useErrorToast } from '../common/hooks';
import { ActionButton, EmptyState, ErrorView, LoadingView, SectionHeader, Segmented, StatGrid } from '../common/layout';
import { Badge, Card, CardContent, useToast } from '../ui';
import { ModuleProps } from './PatientsModule';
import { moduleStyles as s } from './styles';

type View_ = 'staff' | 'patients' | 'signups';

const isLocked = (member: Account) => member.status === 'locked' || Boolean(member.locked_until);
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

function generatePassword(): string {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const digits = '23456789';
    let value = '';
    for (let i = 0; i < 8; i += 1) value += letters[Math.floor(Math.random() * letters.length)];
    for (let i = 0; i < 3; i += 1) value += digits[Math.floor(Math.random() * digits.length)];
    return `${value}!`;
}

/**
 * Accounts in the directory: staff, patients and self-service sign-ups awaiting approval.
 * Accounts are addressed by username; the AAA server enforces staff:read / staff:manage.
 */
export function StaffModule({ refreshKey }: ModuleProps) {
    const { can, user } = useAuth();
    const { withStepUp } = useStepUp();
    const { confirm, notice } = useDialog();
    const { showToast } = useToast();
    const showError = useErrorToast();
    const manage = can(P.STAFF_MANAGE);
    const [view, setView] = useState<View_>('staff');
    const [search, setSearch] = useState('');
    const [editing, setEditing] = useState<Account | null>(null);
    const [creating, setCreating] = useState(false);
    const [reviewing, setReviewing] = useState<Signup | null>(null);
    const [bulkMode, setBulkMode] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [bulkRole, setBulkRole] = useState<string>('');
    const [bulkBusy, setBulkBusy] = useState(false);

    const { data, loading, error, reload } = useAsync(async () => {
        const [accounts, roles, signups] = await Promise.all([
            staffAPI.getAll(),
            roleAPI.getAll(),
            manage ? staffAPI.signups('pending') : Promise.resolve({ data: [] as Signup[] }),
        ]);
        return { accounts: accounts.data, roles: roles.data, signups: signups.data };
    }, [refreshKey, manage]);

    const all = data?.accounts ?? [];
    const staffAccounts = all.filter((a) => a.kind === 'staff' && a.status !== 'pending');
    const patientAccounts = all.filter((a) => a.kind === 'patient');
    const signups = data?.signups ?? [];
    const roles = data?.roles ?? [];
    const staffRoles = roles.filter((r) => !r.is_patient);

    const visible = useMemo(() => {
        const list = view === 'patients' ? patientAccounts : staffAccounts;
        if (!search) return list;
        const term = search.toLowerCase();
        return list.filter((m) => [m.name, m.uid, m.email ?? '', m.role_name ?? ''].some((v) => v.toLowerCase().includes(term)));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data, search, view]);

    const run = async (action: () => Promise<unknown>, success: string, reason?: string) => {
        try {
            await withStepUp(action, reason);
            showToast(success, 'success');
            reload();
        } catch (e) {
            showError(e);
        }
    };

    const resetPassword = async (member: Account) => {
        if (!(await confirm({ title: `Reset password for ${member.name}?`, message: 'A one-time reset code valid for 30 minutes will be generated. Give it to the person directly (in person or by phone).', confirmText: 'Generate code' }))) return;
        try {
            const { data: issued } = await withStepUp(() => staffAPI.resetPassword(member.uid), 'Issuing a password reset code requires re-authentication.');
            await notice({
                title: 'One-time reset code',
                message: `Give this code to ${member.name}. They choose a new password on the "Forgot password" screen with the username ${issued.username}. Expires at ${formatTime(issued.expires_at)}.`,
                codes: [issued.code],
            });
        } catch (e) {
            showError(e);
        }
    };

    const deactivate = async (member: Account) => {
        if (!(await confirm({ title: `Deactivate ${member.name}?`, message: 'They will be signed out everywhere and can no longer sign in. You can reactivate the account later.', confirmText: 'Deactivate', destructive: true }))) return;
        await run(() => staffAPI.deactivate(member.uid), `${member.name} deactivated`);
    };

    const applyBulk = async () => {
        const role = roles.find((r) => r.name === bulkRole);
        if (!role || selected.size === 0) return;
        if (!(await confirm({ title: `Assign ${role.display_name} to ${selected.size} account(s)?`, confirmText: 'Assign role' }))) return;
        setBulkBusy(true);
        let updated = 0;
        try {
            for (const uid of selected) {
                if (uid === user?.uid) continue;
                await withStepUp(() => staffAPI.update(uid, { role: role.name }), 'Changing administrator access requires re-authentication.');
                updated += 1;
            }
            showToast(`Updated ${updated} account(s)`, 'success');
            setSelected(new Set());
            setBulkMode(false);
        } catch (e) {
            showError(e);
        } finally {
            setBulkBusy(false);
            reload();
        }
    };

    return (
        <View>
            <SectionHeader
                title="Accounts"
                subtitle="Stored in the NeuroLock directory (LDAP)"
                action={
                    manage && view === 'staff' ? (
                        <View style={s.row}>
                            <ActionButton label="+ Add staff" small onPress={() => setCreating(true)} />
                            <ActionButton label={bulkMode ? 'Done' : 'Bulk assign'} small variant="secondary" onPress={() => setBulkMode(!bulkMode)} />
                        </View>
                    ) : null
                }
            />
            <StatGrid
                items={[
                    { label: 'Active staff', value: staffAccounts.filter((m) => m.status === 'active').length, icon: '👥' },
                    { label: 'Patients', value: patientAccounts.length, icon: '🌿' },
                    { label: 'Awaiting approval', value: signups.length, icon: '⏳', color: signups.length ? '#d97706' : undefined },
                    { label: 'Locked', value: all.filter(isLocked).length, icon: '🔒', color: '#dc2626' },
                ]}
            />
            <Segmented
                options={[
                    { value: 'staff', label: `Staff (${staffAccounts.length})` },
                    { value: 'patients', label: `Patients (${patientAccounts.length})` },
                    ...(manage ? [{ value: 'signups' as View_, label: `Sign-up approvals (${signups.length})` }] : []),
                ]}
                value={view}
                onChange={(value) => {
                    setView(value);
                    setBulkMode(false);
                }}
            />

            {loading && !data ? <LoadingView /> : null}
            {error ? <ErrorView message={error.message} onRetry={reload} /> : null}

            {view === 'signups' ? (
                <View style={s.list}>
                    {data && signups.length === 0 ? <EmptyState icon="✅" message="No sign-ups waiting for approval" /> : null}
                    {signups.map((signup) => (
                        <Card key={signup.id}>
                            <CardContent style={s.itemContent}>
                                <View style={s.rowBetween}>
                                    <View style={{ flex: 1 }}>
                                        <Text style={s.title}>{signup.name ?? signup.uid}</Text>
                                        <Text style={s.subtitle}>
                                            @{signup.uid} · {signup.email}
                                            {signup.phone ? ` · ${signup.phone}` : ''}
                                        </Text>
                                        <Text style={s.meta}>Registered {formatDateTime(signup.created_at)}</Text>
                                    </View>
                                    <Badge variant="warning">{signup.requested_role_name}</Badge>
                                </View>
                                <View style={s.grid}>
                                    <View style={s.gridItem}>
                                        <Text style={s.gridLabel}>Licence / registration</Text>
                                        <Text style={s.gridValue}>{signup.licence_number ?? '—'}</Text>
                                    </View>
                                    {signup.justification ? (
                                        <View style={[s.gridItem, { flexBasis: '60%' }]}>
                                            <Text style={s.gridLabel}>Note</Text>
                                            <Text style={s.gridValue}>{signup.justification}</Text>
                                        </View>
                                    ) : null}
                                </View>
                                <View style={s.actions}>
                                    <ActionButton label="Review…" small onPress={() => setReviewing(signup)} />
                                </View>
                            </CardContent>
                        </Card>
                    ))}
                </View>
            ) : (
                <>
                    <TextInput style={s.search} value={search} onChangeText={setSearch} placeholder="🔍  Search name, username, email or role…" placeholderTextColor="#94a3b8" />
                    {bulkMode ? (
                        <Card style={{ marginBottom: 12, borderColor: '#93c5fd' }}>
                            <CardContent>
                                <Text style={s.title}>Bulk role assignment</Text>
                                <Text style={s.subtitle}>{selected.size} selected — tap accounts to select</Text>
                                <OptionPicker label="Role to assign" options={staffRoles.map((r) => ({ value: r.name, label: r.display_name }))} value={bulkRole} onChange={setBulkRole} />
                                <ActionButton label={bulkBusy ? 'Assigning…' : `Assign to ${selected.size}`} disabled={!bulkRole || selected.size === 0 || bulkBusy} onPress={applyBulk} />
                            </CardContent>
                        </Card>
                    ) : null}
                    {data && visible.length === 0 ? <EmptyState message={search ? 'No accounts match your search' : 'No accounts yet'} /> : null}
                    <View style={s.list}>
                        {visible.map((member) => {
                            const self = member.uid === user?.uid;
                            const isSelected = selected.has(member.uid);
                            return (
                                <TouchableOpacity
                                    key={member.uid}
                                    activeOpacity={bulkMode ? 0.6 : 1}
                                    disabled={!bulkMode || self}
                                    onPress={() => {
                                        const next = new Set(selected);
                                        if (next.has(member.uid)) next.delete(member.uid);
                                        else next.add(member.uid);
                                        setSelected(next);
                                    }}
                                >
                                    <Card style={isSelected ? { borderColor: '#3b82f6', borderWidth: 2 } : undefined}>
                                        <CardContent style={s.itemContent}>
                                            <View style={s.rowBetween}>
                                                <View style={{ flex: 1 }}>
                                                    <Text style={s.title}>
                                                        {bulkMode ? (isSelected ? '☑ ' : self ? '  ' : '☐ ') : ''}
                                                        {member.name}
                                                        {self ? ' (you)' : ''}
                                                    </Text>
                                                    <Text style={s.subtitle}>
                                                        @{member.uid}
                                                        {member.email ? ` · ${member.email}` : ''}
                                                    </Text>
                                                    <Text style={s.meta}>
                                                        Last sign-in {relativeTime(member.last_login_at)}
                                                        {member.licence_number ? ` · licence ${member.licence_number}` : ''}
                                                    </Text>
                                                </View>
                                                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                                                    <Badge variant="outline">{member.base_role_name ?? 'No role'}</Badge>
                                                    <Badge variant={statusVariant(member.status)}>{titleCase(member.status)}</Badge>
                                                    {member.mfa_enabled ? <Badge variant="success">MFA</Badge> : null}
                                                </View>
                                            </View>
                                            {member.locked_until ? (
                                                <Text style={[s.meta, { color: '#dc2626' }]}>🔒 Locked after failed attempts until {formatTime(member.locked_until)}</Text>
                                            ) : member.status === 'locked' ? (
                                                <Text style={[s.meta, { color: '#dc2626' }]}>🔒 Locked by an administrator</Text>
                                            ) : null}
                                            {manage && !bulkMode ? (
                                                <View style={s.actions}>
                                                    <ActionButton label="✏️ Edit" small variant="secondary" onPress={() => setEditing(member)} />
                                                    {isLocked(member) ? (
                                                        <ActionButton label="🔓 Unlock" small variant="success" onPress={() => run(() => staffAPI.unlock(member.uid), `${member.name} unlocked`)} />
                                                    ) : null}
                                                    {member.status !== 'inactive' && member.status !== 'rejected' ? (
                                                        <ActionButton label="🔑 Reset password" small variant="secondary" onPress={() => resetPassword(member)} />
                                                    ) : null}
                                                    {!self && member.status === 'active' ? (
                                                        <ActionButton label="Sign out" small variant="secondary" onPress={() => run(() => staffAPI.revokeSessions(member.uid), `${member.name} signed out everywhere`)} />
                                                    ) : null}
                                                    {!self && member.status !== 'inactive' && member.status !== 'rejected' ? (
                                                        <ActionButton label="Deactivate" small variant="danger" onPress={() => deactivate(member)} />
                                                    ) : null}
                                                    {member.status === 'inactive' ? (
                                                        <ActionButton label="Reactivate" small variant="success" onPress={() => run(() => staffAPI.update(member.uid, { status: 'active' }), `${member.name} reactivated`)} />
                                                    ) : null}
                                                </View>
                                            ) : null}
                                        </CardContent>
                                    </Card>
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                </>
            )}

            <StaffFormModal
                visible={creating || Boolean(editing)}
                member={editing}
                roles={editing?.kind === 'patient' ? roles.filter((r) => r.is_patient) : staffRoles}
                selfUid={user?.uid}
                onClose={() => {
                    setCreating(false);
                    setEditing(null);
                }}
                onSaved={reload}
            />
            <ReviewSignupModal signup={reviewing} roles={staffRoles} onClose={() => setReviewing(null)} onDone={reload} />
        </View>
    );
}

function ReviewSignupModal({ signup, roles, onClose, onDone }: { signup: Signup | null; roles: Role[]; onClose: () => void; onDone: () => void }) {
    const { withStepUp } = useStepUp();
    const { showToast } = useToast();
    const [role, setRole] = useState('');
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    React.useEffect(() => {
        setRole(signup?.requested_role ?? '');
        setNote('');
        setError(null);
    }, [signup]);

    const act = async (approve: boolean) => {
        if (!signup) return;
        setBusy(true);
        setError(null);
        try {
            if (approve) {
                await withStepUp(() => staffAPI.approveSignup(signup.id, role !== signup.requested_role ? role : undefined), 'Approving administrator access requires re-authentication.');
                showToast(`${signup.name ?? signup.uid} approved — they can now sign in`, 'success');
            } else {
                await staffAPI.rejectSignup(signup.id, note.trim() || undefined);
                showToast(`Sign-up from ${signup.name ?? signup.uid} rejected`, 'success');
            }
            onDone();
            onClose();
        } catch (e: any) {
            setError(e?.message ?? 'Action failed');
        } finally {
            setBusy(false);
        }
    };

    return (
        <FormModal
            visible={Boolean(signup)}
            title={`Review sign-up: ${signup?.name ?? ''}`}
            subtitle={signup ? `@${signup.uid} asked for ${signup.requested_role_name}. Verify the licence number before approving.` : undefined}
            onClose={onClose}
            onSubmit={() => act(true)}
            submitLabel={busy ? 'Working…' : 'Approve'}
            submitting={busy}
            submitDisabled={!role}
            error={error}
        >
            <OptionPicker label="Approve with role" options={roles.map((r) => ({ value: r.name, label: r.display_name }))} value={role} onChange={setRole} />
            <Field label="Note (shown in the audit log)" value={note} onChangeText={setNote} placeholder="Optional reason, e.g. licence could not be verified" />
            <ActionButton label="Reject sign-up" variant="danger" onPress={() => act(false)} disabled={busy} />
        </FormModal>
    );
}

function StaffFormModal({
    visible,
    member,
    roles,
    selfUid,
    onClose,
    onSaved,
}: {
    visible: boolean;
    member: Account | null;
    roles: Role[];
    selfUid?: string;
    onClose: () => void;
    onSaved: () => void;
}) {
    const { withStepUp } = useStepUp();
    const { showToast } = useToast();
    const showError = useErrorToast();
    const [username, setUsername] = useState('');
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [role, setRole] = useState('');
    const [status, setStatus] = useState<Account['status']>('active');
    const [password, setPassword] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const self = member?.uid === selfUid;

    React.useEffect(() => {
        if (!visible) return;
        setError(null);
        setUsername(member?.uid ?? '');
        setName(member?.name ?? '');
        setEmail(member?.email ?? '');
        setPhone(member?.phone ?? '');
        setRole(member?.base_role ?? '');
        setStatus(member?.status ?? 'active');
        setPassword(member ? '' : generatePassword());
    }, [visible, member]);

    const submit = async () => {
        if (!member && !USERNAME_RE.test(username)) return setError('Username: 3-32 lowercase letters, numbers, dots, dashes or underscores');
        if (!name.trim() || !email.trim()) return setError('Name and email are required');
        if (!role) return setError('Choose a role');
        setSaving(true);
        setError(null);
        try {
            if (member) {
                await withStepUp(
                    () => staffAPI.update(member.uid, { name: name.trim(), email: email.trim(), phone: phone.trim() || null, role, ...(self ? {} : { status }) }),
                    'Changing administrator access requires re-authentication.',
                );
                showToast('Account updated', 'success');
            } else {
                await withStepUp(
                    () => staffAPI.create({ username, name: name.trim(), email: email.trim(), phone: phone.trim() || undefined, role, password }),
                    'Creating an administrator requires re-authentication.',
                );
                showToast(`Account @${username} created. Temporary password: ${password}`, 'success', 8000);
            }
            onSaved();
            onClose();
        } catch (e: any) {
            if (['VALIDATION_ERROR', 'CONFLICT', 'LOCKOUT_PREVENTED', 'USERNAME_TAKEN', 'EMAIL_TAKEN', 'FORBIDDEN'].includes(e?.code)) setError(e.message);
            else showError(e);
        } finally {
            setSaving(false);
        }
    };

    const statusOptions: { value: Account['status']; label: string }[] = [
        { value: 'active', label: 'Active' },
        { value: 'locked', label: 'Locked' },
        { value: 'inactive', label: 'Deactivated' },
    ];

    return (
        <FormModal
            visible={visible}
            title={member ? `Edit ${member.kind === 'patient' ? 'patient account' : 'staff member'}` : 'Add staff member'}
            subtitle={member ? `@${member.uid}` : 'The new user signs in with the username and temporary password, then changes it in Settings.'}
            onClose={onClose}
            onSubmit={submit}
            submitting={saving}
            submitLabel={member ? 'Save changes' : 'Create account'}
            error={error}
        >
            {!member ? (
                <Field label="Username" required value={username} onChangeText={(v) => setUsername(v.trim().toLowerCase())} autoCapitalize="none" autoCorrect={false} placeholder="e.g. dr.mehta" />
            ) : null}
            <Field label="Full name" required value={name} onChangeText={setName} />
            <Field label="Email" required value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
            <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
            <OptionPicker label="Role" required options={roles.map((r) => ({ value: r.name, label: r.display_name }))} value={role} onChange={setRole} />
            {self ? <Text style={s.meta}>You cannot change your own role or status.</Text> : null}
            {member && !self ? <OptionPicker label="Account status" options={statusOptions} value={status === 'rejected' ? 'inactive' : status} onChange={(value) => setStatus(value)} /> : null}
            {!member ? (
                <Field label="Temporary password" required value={password} onChangeText={setPassword} autoCapitalize="none" hint="At least 8 characters with a letter and a number" />
            ) : null}
        </FormModal>
    );
}
