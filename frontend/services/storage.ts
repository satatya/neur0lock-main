import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Secrets (the session token) go to the OS keychain/keystore via expo-secure-store on iOS/Android.
 * On web there is no secure store, so AsyncStorage (localStorage) is used instead.
 */
const useSecureStore = Platform.OS !== 'web';

export async function setSecret(key: string, value: string): Promise<void> {
    try {
        if (useSecureStore) await SecureStore.setItemAsync(key, value);
        else await AsyncStorage.setItem(key, value);
    } catch (error) {
        console.warn('Could not store secret', error);
    }
}

export async function getSecret(key: string): Promise<string | null> {
    try {
        return useSecureStore ? await SecureStore.getItemAsync(key) : await AsyncStorage.getItem(key);
    } catch {
        return null;
    }
}

export async function deleteSecret(key: string): Promise<void> {
    try {
        if (useSecureStore) await SecureStore.deleteItemAsync(key);
        else await AsyncStorage.removeItem(key);
    } catch {
        // ignore
    }
}

/** Non-secret device preferences (e.g. whether biometric unlock is enabled on this device). */
export async function getPreference<T>(key: string, fallback: T): Promise<T> {
    try {
        const raw = await AsyncStorage.getItem(key);
        return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
        return fallback;
    }
}

export async function setPreference(key: string, value: unknown): Promise<void> {
    try {
        await AsyncStorage.setItem(key, JSON.stringify(value));
    } catch {
        // ignore
    }
}
