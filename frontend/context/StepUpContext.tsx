import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { ApiError, authAPI, hasStepUp, setStepUpToken } from '../services/api';
import { MODAL_ANIMATION_FADE } from '../components/common/modal';
import { useAuth } from './AuthContext';

/**
 * Step-up (re-)authentication for sensitive actions: reading therapy notes, changing role
 * permissions, issuing password resets, etc. The API answers STEP_UP_REQUIRED; this provider
 * asks for the password (or authenticator code), obtains a short-lived token and retries.
 */
interface StepUpContextValue {
    /** Runs `action`; if the API demands re-authentication, prompts and retries once. */
    withStepUp: <T>(action: () => Promise<T>, reason?: string) => Promise<T>;
    /** Prompts unless a recent re-authentication is still valid. Resolves false if cancelled. */
    ensureStepUp: (reason?: string) => Promise<boolean>;
}

export const CANCELLED = 'CANCELLED';
export const isCancelled = (error: unknown) => error instanceof ApiError && error.code === CANCELLED;

const StepUpContext = createContext<StepUpContextValue | null>(null);

export function StepUpProvider({ children }: { children: React.ReactNode }) {
    const { mfa, logout } = useAuth();
    const [visible, setVisible] = useState(false);
    const [reason, setReason] = useState('');
    const [method, setMethod] = useState<'password' | 'code'>('password');
    const [secret, setSecret] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const resolver = useRef<((ok: boolean) => void) | null>(null);

    const prompt = useCallback((why?: string) => {
        return new Promise<boolean>((resolve) => {
            resolver.current?.(false);
            resolver.current = resolve;
            setReason(why ?? 'This action involves sensitive data. Please confirm your identity.');
            setMethod('password');
            setSecret('');
            setError('');
            setVisible(true);
        });
    }, []);

    const finish = (ok: boolean) => {
        setVisible(false);
        setSecret('');
        resolver.current?.(ok);
        resolver.current = null;
    };

    const submit = async () => {
        if (!secret) return;
        setBusy(true);
        setError('');
        try {
            const { data } = await authAPI.stepUp(method === 'password' ? { password: secret } : { code: secret });
            setStepUpToken(data.step_up_token, data.expires_at);
            finish(true);
        } catch (e) {
            if (e instanceof ApiError && e.status === 423) {
                finish(false);
                await logout('locked');
                return;
            }
            const remaining = e instanceof ApiError ? e.details?.attempts_remaining : undefined;
            setError(
                e instanceof ApiError
                    ? `${e.message}${remaining !== undefined ? ` (${remaining} attempt${remaining === 1 ? '' : 's'} left before lockout)` : ''}`
                    : 'Verification failed',
            );
            setSecret('');
        } finally {
            setBusy(false);
        }
    };

    const ensureStepUp = useCallback(async (why?: string) => (hasStepUp() ? true : prompt(why)), [prompt]);

    const withStepUp = useCallback(
        async <T,>(action: () => Promise<T>, why?: string): Promise<T> => {
            try {
                return await action();
            } catch (e) {
                if (!(e instanceof ApiError) || e.code !== 'STEP_UP_REQUIRED') throw e;
                const ok = await prompt(why ?? e.message);
                if (!ok) throw new ApiError(0, CANCELLED, 'Verification cancelled');
                return action();
            }
        },
        [prompt],
    );

    return (
        <StepUpContext.Provider value={{ withStepUp, ensureStepUp }}>
            {children}
            <Modal visible={visible} transparent animationType={MODAL_ANIMATION_FADE} onRequestClose={() => finish(false)}>
                <View style={styles.overlay}>
                    <View style={styles.card}>
                        <Text style={styles.icon}>🛡️</Text>
                        <Text style={styles.title}>Confirm it's you</Text>
                        <Text style={styles.reason}>{reason}</Text>

                        {mfa.enabled && (
                            <View style={styles.switchRow}>
                                {(['password', 'code'] as const).map((option) => (
                                    <TouchableOpacity
                                        key={option}
                                        style={[styles.switchButton, method === option && styles.switchButtonActive]}
                                        onPress={() => {
                                            setMethod(option);
                                            setSecret('');
                                            setError('');
                                        }}
                                    >
                                        <Text style={[styles.switchText, method === option && styles.switchTextActive]}>
                                            {option === 'password' ? 'Password' : 'Authenticator code'}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        )}

                        <TextInput
                            style={styles.input}
                            value={secret}
                            onChangeText={(text) => setSecret(method === 'code' ? text.replace(/\D/g, '').slice(0, 6) : text)}
                            placeholder={method === 'password' ? 'Your password' : '6-digit code'}
                            placeholderTextColor="#94a3b8"
                            secureTextEntry={method === 'password'}
                            keyboardType={method === 'code' ? 'number-pad' : 'default'}
                            autoCapitalize="none"
                            autoFocus
                            onSubmitEditing={submit}
                            editable={!busy}
                        />
                        {error ? <Text style={styles.error}>{error}</Text> : null}

                        <View style={styles.buttons}>
                            <TouchableOpacity style={[styles.button, styles.cancel]} onPress={() => finish(false)} disabled={busy}>
                                <Text style={styles.cancelText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.button, styles.confirm, !secret && styles.disabled]} onPress={submit} disabled={busy || !secret}>
                                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmText}>Verify</Text>}
                            </TouchableOpacity>
                        </View>
                        <Text style={styles.footnote}>Verification stays valid for 10 minutes.</Text>
                    </View>
                </View>
            </Modal>
        </StepUpContext.Provider>
    );
}

export function useStepUp(): StepUpContextValue {
    const context = useContext(StepUpContext);
    if (!context) throw new Error('useStepUp must be used within StepUpProvider');
    return context;
}

const styles = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.55)', justifyContent: 'center', alignItems: 'center', padding: 20 },
    card: { width: '100%', maxWidth: 400, backgroundColor: '#fff', borderRadius: 16, padding: 24, alignItems: 'stretch' },
    icon: { fontSize: 36, textAlign: 'center', marginBottom: 8 },
    title: { fontSize: 20, fontWeight: '700', color: '#0f172a', textAlign: 'center' },
    reason: { fontSize: 14, color: '#475569', textAlign: 'center', marginTop: 8, marginBottom: 16, lineHeight: 20 },
    switchRow: { flexDirection: 'row', backgroundColor: '#f1f5f9', borderRadius: 8, padding: 4, marginBottom: 12 },
    switchButton: { flex: 1, paddingVertical: 8, borderRadius: 6, alignItems: 'center' },
    switchButtonActive: { backgroundColor: '#3b82f6' },
    switchText: { fontSize: 13, color: '#475569', fontWeight: '500' },
    switchTextActive: { color: '#fff' },
    input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12, fontSize: 16, color: '#0f172a' },
    error: { color: '#dc2626', fontSize: 13, marginTop: 8 },
    buttons: { flexDirection: 'row', gap: 12, marginTop: 20 },
    button: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
    cancel: { backgroundColor: '#f1f5f9' },
    cancelText: { color: '#334155', fontWeight: '600' },
    confirm: { backgroundColor: '#3b82f6' },
    confirmText: { color: '#fff', fontWeight: '600' },
    disabled: { opacity: 0.5 },
    footnote: { fontSize: 12, color: '#94a3b8', textAlign: 'center', marginTop: 12 },
});
