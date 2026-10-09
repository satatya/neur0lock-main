#!/usr/bin/env node
/**
 * Creates the secrets files from the .env.example templates, with fresh random values.
 *
 *   node scripts/setup-env.mjs            # root .env for docker compose
 *   node scripts/setup-env.mjs --dev      # also neurolock-staff-backend/.env and the Python client's .env
 *                                         # (running without Docker), sharing the same KEK
 *
 * Existing files are never overwritten: changing KEK_HEX makes stored therapy notes unreadable, and
 * MySQL/LDAP keep the passwords they were first created with.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dev = process.argv.includes('--dev');

const hex = (bytes) => randomBytes(bytes).toString('hex');
// Fernet key: 32 random bytes, URL-safe base64 with padding
const fernet = () => randomBytes(32).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

const kek = hex(32);
const mysqlPassword = hex(12);

const targets = [
    {
        file: '.env',
        values: {
            MYSQL_ROOT_PASSWORD: hex(16),
            MYSQL_PASSWORD: mysqlPassword,
            LDAP_ADMIN_PASSWORD: hex(16),
            AAA_SECRET_KEY: fernet(),
            KEK_HEX: kek,
        },
    },
];
if (dev) {
    targets.push(
        { file: 'neurolock-staff-backend/.env', values: { KEK_HEX: kek } },
        { file: 'backend/sql-dbms-bundle/sql-dbms/app/.env', values: { KEK_HEX: kek } },
    );
}

let created = 0;
for (const { file, values } of targets) {
    const path = join(root, file);
    const example = join(dirname(path), '.env.example');
    if (existsSync(path)) {
        console.log(`skip    ${file} (already exists - delete it first to regenerate)`);
        continue;
    }
    let text = readFileSync(example, 'utf8');
    for (const [key, value] of Object.entries(values)) {
        const line = new RegExp(`^${key}=.*$`, 'm');
        if (!line.test(text)) throw new Error(`${relative(root, example)} has no ${key}= line`);
        text = text.replace(line, `${key}=${value}`);
    }
    writeFileSync(path, text);
    created += 1;
    console.log(`created ${file}`);
}

if (created) {
    console.log('\nKeep these files private (they are git-ignored). Back up KEK_HEX: encrypted notes cannot be read without it.');
}
