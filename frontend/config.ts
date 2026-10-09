import Constants from 'expo-constants';
import { Platform } from 'react-native';

const API_PORT = 4311;

/**
 * Resolves the backend URL without hard-coding a LAN IP:
 *  1. EXPO_PUBLIC_API_URL (frontend/.env) or app.json "extra.apiUrl" when set explicitly
 *  2. Web: same host as the page
 *  3. Expo Go / dev builds: the machine running the Metro bundler (works on physical devices)
 *  4. Android emulator / iOS simulator defaults
 */
function resolveApiUrl(): string {
    const explicit = process.env.EXPO_PUBLIC_API_URL || (Constants.expoConfig?.extra as any)?.apiUrl;
    if (typeof explicit === 'string' && explicit.trim()) {
        return explicit.trim().replace(/\/+$/, '');
    }

    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.hostname) {
        return `${window.location.protocol}//${window.location.hostname}:${API_PORT}/api`;
    }

    const hostUri: string | undefined =
        Constants.expoConfig?.hostUri ??
        (Constants as any).manifest2?.extra?.expoGo?.debuggerHost ??
        (Constants as any).manifest?.debuggerHost;
    if (hostUri) {
        const host = hostUri.split(':')[0];
        if (host) return `http://${host}:${API_PORT}/api`;
    }

    return Platform.OS === 'android' ? `http://10.0.2.2:${API_PORT}/api` : `http://localhost:${API_PORT}/api`;
}

export const API_BASE_URL = resolveApiUrl();

export const DEMO_PASSWORD = 'Demo@1234';
/** One demo account per role (created by the AAA server on first start). Sign in with the username. */
export const DEMO_ACCOUNTS = [
    { role: 'Admin (can switch roles)', username: 'admin' },
    { role: 'Psychiatrist (Doctor)', username: 'psychiatrist' },
    { role: 'Psychologist', username: 'psychologist' },
    { role: 'Therapist', username: 'therapist' },
    { role: 'Nurse', username: 'nurse' },
    { role: 'Patient', username: 'patient' },
];
