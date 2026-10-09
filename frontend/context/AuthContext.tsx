import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import {
    Account,
    ApiError,
    authAPI,
    clearStepUpToken,
    MfaChallenge,
    registerSessionHandlers,
    SessionPayload,
    setAuthToken,
    UserSettings,
} from '../services/api';
import { clearOfflineCache } from '../services/offlineCache';
import { deleteSecret, getPreference, getSecret, setPreference, setSecret } from '../services/storage';

/**
 * chooseRole: an administrator just signed in and picks which role to use (including Administrator).
 * Everyone else goes straight to the dashboard of the role assigned to their account.
 */
type AuthStatus = 'loading' | 'signedOut' | 'mfa' | 'biometricLock' | 'chooseRole' | 'signedIn';

export interface LockNotice {
    email?: string | null;
    lockReason?: string;
    lockedUntil?: string | null;
    message?: string;
}

interface StoredSession {
    token: string;
    expires_at: string;
    uid: string;
}

interface AuthContextValue {
    status: AuthStatus;
    user: Account | null;
    permissions: Set<string>;
    settings: UserSettings;
    mfa: { enabled: boolean; backup_codes_remaining: number };
    passwordChangedAt: string | null;
    challenge: MfaChallenge | null;
    signOutMessage: string | null;
    /** Details of a lockout that happened during the MFA step, shown on the lock screen. */
    lockNotice: LockNotice | null;
    setLockNotice: (notice: LockNotice | null) => void;
    biometricEnabled: boolean;
    biometricAvailable: boolean;
    /** identifier = username or email. Returns 'mfa' when a second factor is required. Throws ApiError on failure. */
    login: (identifier: string, password: string) => Promise<'signedIn' | 'chooseRole' | 'mfa'>;
    /** Administrators: use the app as `role` (null = own Administrator role). */
    actAs: (role: string | null) => Promise<void>;
    /** Administrators: go back to the role chooser. */
    chooseRole: () => void;
    /** Administrators: leave the role chooser and continue with the current role. */
    resumeSession: () => void;
    verifyMfa: (input: { code?: string; backupCode?: string }) => Promise<void>;
    cancelMfa: () => void;
    logout: (reason?: string) => Promise<void>;
    refresh: () => Promise<void>;
    can: (permission: string) => boolean;
    canAny: (...permissions: string[]) => boolean;
    unlockWithBiometrics: () => Promise<boolean>;
    setBiometricEnabled: (enabled: boolean) => Promise<void>;
    updateSettings: (settings: UserSettings) => Promise<void>;
    touch: () => void;
    clearSignOutMessage: () => void;
}

const SESSION_KEY = 'neurolock.session';
const BIOMETRIC_KEY = 'neurolock.biometricUnlock';
const PERMISSION_REFRESH_MS = 60_000;
const DEFAULT_AUTO_LOCK_MINUTES = 15;

const AuthContext = createContext<AuthContextValue | null>(null);

const SIGN_OUT_MESSAGES: Record<string, string> = {
    inactivity: 'You were signed out after a period of inactivity.',
    SESSION_EXPIRED: 'Your session has ended. Please sign in again.',
    INVALID_TOKEN: 'Your session has ended. Please sign in again.',
    ACCOUNT_DISABLED: 'This account is locked or deactivated. Contact your administrator.',
    UNAUTHORIZED: 'Please sign in again.',
    locked: 'Your account was locked after too many failed verification attempts.',
    password_changed: 'Your password was changed. Please sign in again.',
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [status, setStatus] = useState<AuthStatus>('loading');
    const [user, setUser] = useState<Account | null>(null);
    const [permissions, setPermissions] = useState<Set<string>>(new Set());
    const [settings, setSettings] = useState<UserSettings>({});
    const [mfa, setMfa] = useState({ enabled: false, backup_codes_remaining: 0 });
    const [passwordChangedAt, setPasswordChangedAt] = useState<string | null>(null);
    const [challenge, setChallenge] = useState<MfaChallenge | null>(null);
    const [signOutMessage, setSignOutMessage] = useState<string | null>(null);
    const [lockNotice, setLockNotice] = useState<LockNotice | null>(null);
    const [biometricEnabled, setBiometricEnabledState] = useState(false);
    const [biometricAvailable, setBiometricAvailable] = useState(false);

    const lastActivity = useRef(Date.now());
    const lastForbiddenRefresh = useRef(0);
    const statusRef = useRef(status);
    statusRef.current = status;

    const clearLocalSession = useCallback(async () => {
        setAuthToken(null);
        clearStepUpToken();
        clearOfflineCache();
        await deleteSecret(SESSION_KEY);
        setUser(null);
        setPermissions(new Set());
        setSettings({});
        setChallenge(null);
    }, []);

    const refresh = useCallback(async () => {
        const { data } = await authAPI.me();
        setUser(data.user);
        setPermissions(new Set(data.permissions));
        setSettings(data.settings ?? {});
        setMfa(data.mfa);
        setPasswordChangedAt(data.password_changed_at);
    }, []);

    const endSession = useCallback(
        async (reason: string) => {
            await clearLocalSession();
            setSignOutMessage(SIGN_OUT_MESSAGES[reason] ?? null);
            setStatus('signedOut');
        },
        [clearLocalSession],
    );

    const logout = useCallback(
        async (reason?: string) => {
            try {
                await authAPI.logout();
            } catch {
                // The session may already be gone server-side; clear it locally regardless.
            }
            await endSession(reason ?? 'manual');
        },
        [endSession],
    );

    const startSession = useCallback(
        async (payload: SessionPayload) => {
            setAuthToken(payload.token);
            await setSecret(SESSION_KEY, JSON.stringify({ token: payload.token, expires_at: payload.expires_at, uid: payload.user.uid } as StoredSession));
            setUser(payload.user);
            setPermissions(new Set(payload.permissions));
            setChallenge(null);
            setSignOutMessage(null);
            lastActivity.current = Date.now();
            try {
                await refresh();
            } catch {
                // /auth/me failing right after login is non-fatal; the payload already has the essentials.
            }
            const next = payload.user.can_act_as ? 'chooseRole' : 'signedIn';
            setStatus(next);
            return next;
        },
        [refresh],
    );

    // Restore a stored session on start-up.
    useEffect(() => {
        registerSessionHandlers({
            onSessionEnded: (reason) => {
                if (['signedIn', 'biometricLock', 'chooseRole'].includes(statusRef.current)) void endSession(reason);
            },
            onForbidden: () => {
                // A 403 may mean an administrator just changed this role's permissions.
                if (statusRef.current !== 'signedIn' || Date.now() - lastForbiddenRefresh.current < 5_000) return;
                lastForbiddenRefresh.current = Date.now();
                refresh().catch(() => undefined);
            },
        });

        (async () => {
            const hardware = Platform.OS !== 'web' && (await LocalAuthentication.hasHardwareAsync().catch(() => false));
            const enrolled = hardware && (await LocalAuthentication.isEnrolledAsync().catch(() => false));
            setBiometricAvailable(Boolean(enrolled));
            const biometric = Boolean(enrolled) && (await getPreference<boolean>(BIOMETRIC_KEY, false));
            setBiometricEnabledState(biometric);

            const raw = await getSecret(SESSION_KEY);
            const stored: StoredSession | null = raw ? JSON.parse(raw) : null;
            if (!stored || new Date(stored.expires_at).getTime() <= Date.now()) {
                await deleteSecret(SESSION_KEY);
                setStatus('signedOut');
                return;
            }
            setAuthToken(stored.token);
            if (biometric) {
                setStatus('biometricLock');
                return;
            }
            try {
                await refresh();
                setStatus('signedIn');
            } catch (error) {
                await clearLocalSession();
                if (error instanceof ApiError && error.code === 'NETWORK_ERROR') setSignOutMessage(error.message);
                setStatus('signedOut');
            }
        })();
    }, [clearLocalSession, endSession, refresh]);

    // Keep permissions in sync with server-side role changes.
    useEffect(() => {
        if (status !== 'signedIn') return undefined;
        const interval = setInterval(() => {
            if (AppState.currentState === 'active') refresh().catch(() => undefined);
        }, PERMISSION_REFRESH_MS);
        const subscription = AppState.addEventListener('change', (state) => {
            if (state === 'active') refresh().catch(() => undefined);
        });
        return () => {
            clearInterval(interval);
            subscription.remove();
        };
    }, [status, refresh]);

    // Automatic sign-out after inactivity (configurable in Settings).
    useEffect(() => {
        if (status !== 'signedIn') return undefined;
        const limitMs = (settings.auto_lock_minutes ?? DEFAULT_AUTO_LOCK_MINUTES) * 60_000;
        const interval = setInterval(() => {
            if (Date.now() - lastActivity.current > limitMs) void logout('inactivity');
        }, 15_000);
        return () => clearInterval(interval);
    }, [status, settings.auto_lock_minutes, logout]);

    const login = useCallback(
        async (identifier: string, password: string) => {
            setLockNotice(null);
            const { data } = await authAPI.login(identifier.trim().toLowerCase(), password);
            if ('mfa_required' in data) {
                setChallenge(data);
                setStatus('mfa');
                return 'mfa' as const;
            }
            return startSession(data);
        },
        [startSession],
    );

    const actAs = useCallback(async (role: string | null) => {
        const { data } = await authAPI.actAs(role);
        clearStepUpToken();
        setUser(data.user);
        setPermissions(new Set(data.permissions));
        setSettings(data.settings ?? {});
        setMfa(data.mfa);
        lastActivity.current = Date.now();
        setStatus('signedIn');
    }, []);

    const chooseRole = useCallback(() => {
        setStatus('chooseRole');
    }, []);

    const resumeSession = useCallback(() => {
        setStatus((current) => (current === 'chooseRole' ? 'signedIn' : current));
    }, []);

    const verifyMfa = useCallback(
        async ({ code, backupCode }: { code?: string; backupCode?: string }) => {
            if (!challenge) throw new ApiError(0, 'MFA_EXPIRED', 'Please sign in again.');
            const { data } = await authAPI.verifyMfa(challenge.mfa_token, code, backupCode);
            await startSession(data);
        },
        [challenge, startSession],
    );

    const cancelMfa = useCallback(() => {
        setChallenge(null);
        setStatus('signedOut');
    }, []);

    const unlockWithBiometrics = useCallback(async () => {
        const result = await LocalAuthentication.authenticateAsync({
            promptMessage: 'Unlock NeuroLock',
            fallbackLabel: 'Use device passcode',
            disableDeviceFallback: false,
        });
        if (!result.success) return false;
        try {
            const { data } = await authAPI.me();
            setUser(data.user);
            setPermissions(new Set(data.permissions));
            setSettings(data.settings ?? {});
            setMfa(data.mfa);
            setPasswordChangedAt(data.password_changed_at);
            lastActivity.current = Date.now();
            // Administrators choose their role again after unlocking; everyone else resumes their own role.
            setStatus(data.user.can_act_as ? 'chooseRole' : 'signedIn');
            return true;
        } catch {
            await clearLocalSession();
            setSignOutMessage('Your saved session has expired. Please sign in with your password.');
            setStatus('signedOut');
            return false;
        }
    }, [refresh, clearLocalSession]);

    const setBiometricEnabled = useCallback(async (enabled: boolean) => {
        await setPreference(BIOMETRIC_KEY, enabled);
        setBiometricEnabledState(enabled);
    }, []);

    const updateSettings = useCallback(async (next: UserSettings) => {
        const { data } = await authAPI.saveSettings(next);
        setSettings(data);
    }, []);

    const value = useMemo<AuthContextValue>(
        () => ({
            status,
            user,
            permissions,
            settings,
            mfa,
            passwordChangedAt,
            challenge,
            signOutMessage,
            lockNotice,
            setLockNotice,
            biometricEnabled,
            biometricAvailable,
            login,
            actAs,
            chooseRole,
            resumeSession,
            verifyMfa,
            cancelMfa,
            logout,
            refresh,
            can: (permission: string) => permissions.has(permission),
            canAny: (...codes: string[]) => codes.some((code) => permissions.has(code)),
            unlockWithBiometrics,
            setBiometricEnabled,
            updateSettings,
            touch: () => {
                lastActivity.current = Date.now();
            },
            clearSignOutMessage: () => setSignOutMessage(null),
        }),
        [
            status,
            user,
            permissions,
            settings,
            mfa,
            passwordChangedAt,
            challenge,
            signOutMessage,
            lockNotice,
            biometricEnabled,
            biometricAvailable,
            login,
            actAs,
            chooseRole,
            resumeSession,
            verifyMfa,
            cancelMfa,
            logout,
            refresh,
            unlockWithBiometrics,
            setBiometricEnabled,
            updateSettings,
        ],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used within AuthProvider');
    return context;
}
