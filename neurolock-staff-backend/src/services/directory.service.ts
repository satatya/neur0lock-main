/**
 * Keeps the MySQL directory mirror (`staff` table) in step with the AAA directory so clinical
 * records can reference accounts by a stable numeric id. No credentials are stored here.
 */
import { aaa } from '../infra/aaa-client';
import { execute, query, queryOne } from '../infra/db/mysql-client';
import { AaaUser } from '../types/auth';

interface MirrorEntry {
    id: number;
    signature: string;
    at: number;
}

const MIRROR_TTL_MS = 5 * 60_000;
const mirrorCache = new Map<string, MirrorEntry>();

export interface DirectoryEntry {
    id: number;
    uid: string;
    name: string;
    email: string | null;
    role: string;
    role_name: string;
    /** Clinician patients can book appointments with. */
    bookable: boolean;
}

const signatureOf = (fields: (string | null | undefined)[]) => fields.map((f) => f ?? '').join('|');

/** Upserts one account into the mirror and returns its numeric id. */
export async function mirrorAccount(entry: { uid: string; name: string; email?: string | null; role?: string | null; role_name?: string | null; kind?: 'staff' | 'patient' }): Promise<number> {
    const kind = entry.kind ?? 'staff';
    const signature = signatureOf([entry.name, entry.email, entry.role, entry.role_name, kind]);
    const cached = mirrorCache.get(entry.uid);
    if (cached && cached.signature === signature && Date.now() - cached.at < MIRROR_TTL_MS) return cached.id;

    await execute(
        `INSERT INTO staff (uid, email, name, role, role_name, kind) VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE email = VALUES(email), name = VALUES(name), role = VALUES(role), role_name = VALUES(role_name), kind = VALUES(kind)`,
        [entry.uid, entry.email ?? null, entry.name || entry.uid, entry.role ?? null, entry.role_name ?? null, kind],
    );
    const row = await queryOne<{ id: number }>('SELECT id FROM staff WHERE uid = ?', [entry.uid]);
    if (!row) throw new Error(`Directory mirror upsert failed for ${entry.uid}`);
    mirrorCache.set(entry.uid, { id: Number(row.id), signature, at: Date.now() });
    return Number(row.id);
}

/** Mirrors the signed-in account using its directory (base) role, not an admin's acting role. */
export const mirrorUser = (user: AaaUser) =>
    mirrorAccount({ uid: user.uid, name: user.name, email: user.email, role: user.base_role, role_name: user.base_role_name, kind: user.kind });

let directoryCache: { at: number; entries: DirectoryEntry[] } | null = null;
const DIRECTORY_TTL_MS = 15_000;

/** Active clinical staff (from the AAA directory) with their mirror ids, for pickers and validation. */
export async function activeStaffDirectory(token: string | null, force = false): Promise<DirectoryEntry[]> {
    if (!force && directoryCache && Date.now() - directoryCache.at < DIRECTORY_TTL_MS) return directoryCache.entries;
    const { data } = await aaa<Omit<DirectoryEntry, 'id'>[]>('GET', '/directory', { token });
    const entries: DirectoryEntry[] = [];
    for (const person of data) {
        const id = await mirrorAccount({ ...person, kind: 'staff' });
        entries.push({ id, ...person });
    }
    directoryCache = { at: Date.now(), entries };
    return entries;
}

export function invalidateDirectoryCache(uid?: string): void {
    directoryCache = null;
    if (uid) mirrorCache.delete(uid);
}

/** True when the mirror id belongs to an active clinical staff account in the directory. */
export async function isActiveStaff(id: number, token: string | null): Promise<boolean> {
    const entries = await activeStaffDirectory(token);
    if (entries.some((entry) => entry.id === id)) return true;
    // The cache may be a few seconds old (e.g. a sign-up approved just now)
    return (await activeStaffDirectory(token, true)).some((entry) => entry.id === id);
}

/** Mirror id of an existing account (cached), e.g. the demo account an administrator previews. */
export async function mirrorIdForUid(uid: string): Promise<number | null> {
    const cached = mirrorCache.get(uid);
    if (cached && Date.now() - cached.at < MIRROR_TTL_MS) return cached.id;
    const row = await queryOne<{ id: number }>('SELECT id FROM staff WHERE uid = ?', [uid]);
    return row ? Number(row.id) : null;
}

export async function mirrorIdsByUid(uids: string[]): Promise<Map<string, number>> {
    if (uids.length === 0) return new Map();
    const rows = await query<{ id: number; uid: string }>(`SELECT id, uid FROM staff WHERE uid IN (${uids.map(() => '?').join(',')})`, uids);
    return new Map(rows.map((row) => [row.uid, Number(row.id)]));
}
