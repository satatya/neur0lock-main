import { Patient } from './api';

/**
 * In-memory snapshot of the last patient list, used by Offline mode when the server becomes
 * unreachable mid-session. It is deliberately NOT persisted to disk and is cleared on sign-out,
 * so no patient data survives on the device after the app is closed.
 */
export interface CachedPatient {
    id: number;
    mrn: string;
    full_name: string;
    age: number | null;
    ward: string | null;
    room: string | null;
    status: string;
    priority: string;
    primary_diagnosis: string | null;
    attending_physician_name: string | null;
}

let snapshot: { patients: CachedPatient[]; savedAt: number } | null = null;

export function cachePatients(patients: Patient[]) {
    snapshot = {
        savedAt: Date.now(),
        patients: patients.map((p) => ({
            id: p.id,
            mrn: p.mrn,
            full_name: p.full_name,
            age: p.age,
            ward: p.ward,
            room: p.room,
            status: p.status,
            priority: p.priority,
            primary_diagnosis: p.primary_diagnosis,
            attending_physician_name: p.attending_physician_name,
        })),
    };
}

export const getCachedPatients = () => snapshot;

export function clearOfflineCache() {
    snapshot = null;
}
