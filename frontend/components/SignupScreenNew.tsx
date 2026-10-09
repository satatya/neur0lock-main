import React, { useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, authAPI, SignupResult, SignupRole } from '../services/api';
import { roleTheme } from '../constants/permissions';
import { Alert, Badge, Button, Card, CardContent } from './ui';
import { colors, ErrorView, InfoRow, ScreenHeader } from './common/layout';
import { Field, OptionPicker } from './common/forms';
import { useAsync } from './common/hooks';
import { isValidDateString } from './common/format';
import { useHardwareBack } from './common/back';

interface SignupScreenNewProps {
  navigation: any;
}

type Step = 'role' | 'details' | 'password' | 'review' | 'done';
const STEPS: Step[] = ['role', 'details', 'password', 'review'];
const STEP_LABELS: Record<Step, string> = { role: 'Role', details: 'Details', password: 'Password', review: 'Review', done: 'Done' };

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENDERS = ['Female', 'Male', 'Non-binary', 'Other', 'Prefer not to say'] as const;

function passwordProblem(password: string): string | null {
  if (password.length < 8 || password.length > 128) return 'Use 8 to 128 characters.';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Include at least one letter and one number.';
  return null;
}

/**
 * Self-service sign-up. The person chooses their role here (never Administrator). Patients can sign
 * in straight away; clinical staff wait until an administrator approves the account. After that,
 * signing in takes them directly to their role's dashboard.
 */
export function SignupScreenNew({ navigation }: SignupScreenNewProps) {
  const roles = useAsync(async () => (await authAPI.signupRoles()).data, []);
  const [step, setStep] = useState<Step>('role');
  const [role, setRole] = useState<SignupRole | null>(null);
  const [form, setForm] = useState({
    username: '',
    name: '',
    email: '',
    phone: '',
    dob: '',
    gender: '' as (typeof GENDERS)[number] | '',
    mrn: '',
    licence: '',
    justification: '',
    password: '',
    confirm: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [result, setResult] = useState<SignupResult | null>(null);

  const set = (key: keyof typeof form) => (value: string) => {
    setForm((current) => ({ ...current, [key]: key === 'username' ? value.trim().toLowerCase() : value }));
    setErrors((current) => ({ ...current, [key]: '' }));
  };

  const validateDetails = () => {
    const next: Record<string, string> = {};
    if (!USERNAME_RE.test(form.username)) next.username = '3-32 characters: lowercase letters, numbers, dots, dashes or underscores.';
    if (form.name.trim().length < 2) next.name = 'Enter your full name.';
    if (!EMAIL_RE.test(form.email.trim())) next.email = 'Enter a valid email address.';
    if (role?.is_patient) {
      if (!isValidDateString(form.dob)) next.dob = 'Use the format YYYY-MM-DD.';
      else if (form.dob > new Date().toISOString().slice(0, 10)) next.dob = 'Date of birth cannot be in the future.';
    }
    if (role?.requires_approval && !form.licence.trim()) next.licence = 'Your professional registration / licence number is required.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const validatePassword = () => {
    const next: Record<string, string> = {};
    const problem = passwordProblem(form.password);
    if (problem) next.password = problem;
    else if (form.password !== form.confirm) next.confirm = 'Passwords do not match.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const goNext = () => {
    setServerError(null);
    if (step === 'role' && role) setStep('details');
    else if (step === 'details' && validateDetails()) setStep('password');
    else if (step === 'password' && validatePassword()) setStep('review');
  };

  const goBack = () => {
    setServerError(null);
    const index = STEPS.indexOf(step);
    if (index <= 0) navigation.goBack();
    else setStep(STEPS[index - 1]);
  };

  const submit = async () => {
    if (!role) return;
    setSubmitting(true);
    setServerError(null);
    try {
      const { data } = await authAPI.signup({
        role: role.name,
        username: form.username,
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim() || undefined,
        password: form.password,
        ...(role.is_patient
          ? { dob: form.dob, gender: form.gender || undefined, mrn: form.mrn.trim().toUpperCase() || undefined }
          : { licence_number: form.licence.trim(), justification: form.justification.trim() || undefined }),
      });
      setResult(data);
      setStep('done');
    } catch (error) {
      if (error instanceof ApiError) {
        const field = error.details?.field as string | undefined;
        const stepForField: Record<string, Step> = {
          username: 'details', email: 'details', name: 'details', dob: 'details', mrn: 'details', licence_number: 'details', password: 'password', role: 'role',
        };
        if (error.code === 'USERNAME_TAKEN') {
          setErrors({ username: error.message });
          setStep('details');
        } else if (error.code === 'EMAIL_TAKEN') {
          setErrors({ email: error.message });
          setStep('details');
        } else if (field && stepForField[field]) {
          setErrors({ [field === 'licence_number' ? 'licence' : field]: error.message });
          setStep(stepForField[field]);
        }
        setServerError(error.message);
      } else {
        setServerError('Sign-up failed. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Android back: previous step instead of leaving the form
  useHardwareBack(() => {
    if (step === 'role' || step === 'done') return false;
    goBack();
    return true;
  });

  const stepIndex = STEPS.indexOf(step);
  const theme = useMemo(() => roleTheme(role?.name, role?.display_name), [role]);

  if (step === 'done' && result) {
    const pending = result.status === 'pending';
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.doneIcon}>
            <Text style={{ fontSize: 48 }}>{pending ? '⏳' : '✅'}</Text>
          </View>
          <Text style={styles.doneTitle}>{pending ? 'Registration received' : 'Account created'}</Text>
          <Text style={styles.doneText}>
            {pending
              ? `Your ${result.role_name} account (@${result.uid}) is waiting for an administrator to verify your details. You can sign in as soon as it is approved — you will go straight to the ${result.role_name} dashboard.`
              : `Welcome, ${result.name}. Sign in with your username @${result.uid} to see your appointments, medications and results.`}
          </Text>
          <Button onPress={() => navigation.navigate('LoginNew')} style={styles.primary}>
            <Text style={styles.primaryText}>{pending ? 'Back to sign in' : 'Sign in now'}</Text>
          </Button>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Create account" subtitle={`Step ${stepIndex + 1} of ${STEPS.length} · ${STEP_LABELS[step]}`} onBack={goBack} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.progress}>
            {STEPS.map((item, index) => (
              <View key={item} style={[styles.progressBar, index <= stepIndex && styles.progressBarActive]} />
            ))}
          </View>

          {step === 'role' ? (
            <>
              <Text style={styles.heading}>Who are you signing up as?</Text>
              <Text style={styles.help}>Your role decides what you can see. Clinical roles are verified by an administrator before first sign-in.</Text>
              {roles.loading ? <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} /> : null}
              {roles.error ? <ErrorView message={roles.error.message} onRetry={roles.reload} /> : null}
              <View style={styles.roleList}>
                {(roles.data ?? []).map((option) => {
                  const optionTheme = roleTheme(option.name, option.display_name);
                  const selected = role?.name === option.name;
                  return (
                    <TouchableOpacity
                      key={option.name}
                      style={[styles.roleCard, selected && { borderColor: optionTheme.colors[0], borderWidth: 2 }]}
                      onPress={() => setRole(option)}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.roleIcon}>{optionTheme.icon}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.roleTitle}>{option.display_name}</Text>
                        {option.description ? <Text style={styles.roleText}>{option.description}</Text> : null}
                      </View>
                      {option.requires_approval ? <Badge variant="warning">Needs approval</Badge> : <Badge variant="success">Instant</Badge>}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          ) : null}

          {step === 'details' && role ? (
            <Card>
              <CardContent style={styles.formCard}>
                <Text style={styles.heading}>
                  {theme.icon} {role.display_name} details
                </Text>
                <Field label="Username" required value={form.username} onChangeText={set('username')} autoCapitalize="none" autoCorrect={false} placeholder="e.g. riya.jain" hint={errors.username || 'You will sign in with this.'} style={errors.username ? styles.invalid : undefined} />
                <Field label="Full name" required value={form.name} onChangeText={set('name')} placeholder="First and last name" hint={errors.name} style={errors.name ? styles.invalid : undefined} />
                <Field label="Email" required value={form.email} onChangeText={set('email')} autoCapitalize="none" keyboardType="email-address" placeholder="you@example.org" hint={errors.email} style={errors.email ? styles.invalid : undefined} />
                <Field label="Phone" value={form.phone} onChangeText={set('phone')} keyboardType="phone-pad" placeholder="Optional" />
                {role.is_patient ? (
                  <>
                    <Field label="Date of birth" required value={form.dob} onChangeText={set('dob')} placeholder="YYYY-MM-DD" hint={errors.dob} style={errors.dob ? styles.invalid : undefined} />
                    <OptionPicker label="Gender" options={GENDERS} value={form.gender} onChange={(value) => setForm((f) => ({ ...f, gender: value }))} />
                    <Field
                      label="Patient number (MRN)"
                      value={form.mrn}
                      onChangeText={set('mrn')}
                      autoCapitalize="characters"
                      placeholder="Optional, e.g. MRN001"
                      hint={errors.mrn || 'Already a patient here? Enter your MRN (it must match your date of birth) to link your records. Leave empty if you are new.'}
                      style={errors.mrn ? styles.invalid : undefined}
                    />
                  </>
                ) : (
                  <>
                    <Field label="Professional registration / licence number" required value={form.licence} onChangeText={set('licence')} autoCapitalize="characters" placeholder="e.g. RCI-12345" hint={errors.licence || 'An administrator verifies this before approving your access.'} style={errors.licence ? styles.invalid : undefined} />
                    <Field label="Note for the administrator" value={form.justification} onChangeText={set('justification')} multiline placeholder="Optional: department, start date…" />
                  </>
                )}
              </CardContent>
            </Card>
          ) : null}

          {step === 'password' ? (
            <Card>
              <CardContent style={styles.formCard}>
                <Text style={styles.heading}>Choose a password</Text>
                <Field label="Password" required value={form.password} onChangeText={set('password')} secureTextEntry textContentType="newPassword" hint={errors.password || 'At least 8 characters with a letter and a number.'} style={errors.password ? styles.invalid : undefined} />
                <Field label="Confirm password" required value={form.confirm} onChangeText={set('confirm')} secureTextEntry textContentType="newPassword" hint={errors.confirm} style={errors.confirm ? styles.invalid : undefined} onSubmitEditing={goNext} />
                <Text style={styles.help}>After signing in you can turn on an authenticator app (MFA) and fingerprint / face unlock in Settings.</Text>
              </CardContent>
            </Card>
          ) : null}

          {step === 'review' && role ? (
            <Card>
              <CardContent style={styles.formCard}>
                <Text style={styles.heading}>Check your details</Text>
                <InfoRow label="Role" value={role.display_name} />
                <InfoRow label="Username" value={`@${form.username}`} />
                <InfoRow label="Name" value={form.name} />
                <InfoRow label="Email" value={form.email} />
                {form.phone ? <InfoRow label="Phone" value={form.phone} /> : null}
                {role.is_patient ? <InfoRow label="Date of birth" value={form.dob} /> : null}
                {role.is_patient && form.mrn ? <InfoRow label="Link to MRN" value={form.mrn.toUpperCase()} /> : null}
                {!role.is_patient ? <InfoRow label="Licence number" value={form.licence} /> : null}
                <Alert
                  variant={role.requires_approval ? 'warning' : 'success'}
                  title={role.requires_approval ? 'Administrator approval required' : 'Ready to go'}
                  description={
                    role.requires_approval
                      ? 'You can sign in once an administrator has verified and approved your account.'
                      : 'You can sign in right after creating your account.'
                  }
                  style={{ marginTop: 16 }}
                />
              </CardContent>
            </Card>
          ) : null}

          {serverError ? <Alert variant="destructive" title="Could not create account" description={serverError} style={{ marginTop: 16 }} /> : null}

          <View style={styles.footer}>
            {step === 'review' ? (
              <Button onPress={submit} loading={submitting} disabled={submitting} style={styles.primary}>
                <Text style={styles.primaryText}>Create account</Text>
              </Button>
            ) : (
              <Button onPress={goNext} disabled={step === 'role' && !role} style={styles.primary}>
                <Text style={styles.primaryText}>Continue</Text>
              </Button>
            )}
            <TouchableOpacity onPress={() => navigation.navigate('LoginNew')} style={styles.loginLink}>
              <Text style={styles.help}>
                Already have an account? <Text style={styles.link}>Sign in</Text>
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 48, maxWidth: 640, width: '100%', alignSelf: 'center' },
  progress: { flexDirection: 'row', gap: 6, marginBottom: 20 },
  progressBar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.border },
  progressBarActive: { backgroundColor: colors.primary },
  heading: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 8 },
  help: { fontSize: 13, color: colors.muted, lineHeight: 19 },
  roleList: { gap: 10, marginTop: 16 },
  roleCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border },
  roleIcon: { fontSize: 28 },
  roleTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  roleText: { fontSize: 12, color: colors.muted, marginTop: 2 },
  formCard: { paddingVertical: 16 },
  invalid: { borderColor: colors.danger },
  footer: { marginTop: 20, gap: 12 },
  primary: { paddingVertical: 14 },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  loginLink: { alignItems: 'center', marginTop: 4 },
  link: { color: colors.primary, fontWeight: '600' },
  doneIcon: { alignItems: 'center', marginTop: 48, marginBottom: 12 },
  doneTitle: { fontSize: 24, fontWeight: '700', color: colors.text, textAlign: 'center' },
  doneText: { fontSize: 15, color: colors.muted, textAlign: 'center', lineHeight: 22, marginVertical: 16 },
});
