/**
 * (Re)creates the NeuroLock database from the SQL init scripts and seeds encrypted demo notes.
 *
 *   npm run db:setup            -> creates the schema if the database is empty
 *   npm run db:setup -- --reset -> DROPS the database and recreates it (all data is lost)
 *
 * The MySQL docker container runs the same SQL files automatically on first start; run this
 * afterwards (without --reset) to add the encrypted demo therapy notes, which need the KEK.
 */
import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import { config } from '../src/config/env';

const INIT_DIR = path.resolve(__dirname, '../../backend/sql-dbms-bundle/sql-dbms/db/init');

/** Points the init scripts at the configured database name (they default to `neurolock`). */
function prepareSql(sql: string): string {
    return sql.replace(/(CREATE DATABASE IF NOT EXISTS\s+|USE\s+)neurolock\b/g, `$1\`${config.db.database}\``);
}

async function main() {
    const reset = process.argv.includes('--reset');
    const connection = await mysql.createConnection({
        host: config.db.host,
        port: config.db.port,
        user: config.db.user,
        password: config.db.password,
        multipleStatements: true,
        timezone: 'Z',
    });
    await connection.query("SET time_zone = '+00:00'");

    const [existing] = await connection.query<any[]>(
        'SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = ?',
        [config.db.database],
    );
    const hasTables = Number(existing[0].total) > 0;

    if (hasTables && reset) {
        console.log(`Dropping database ${config.db.database} ...`);
        await connection.query(`DROP DATABASE \`${config.db.database}\``);
    }

    if (!hasTables || reset) {
        const files = fs.readdirSync(INIT_DIR).filter((file) => file.endsWith('.sql')).sort();
        for (const file of files) {
            console.log(`Applying ${file}`);
            await connection.query(prepareSql(fs.readFileSync(path.join(INIT_DIR, file), 'utf-8')));
        }
    } else {
        console.log(`Database ${config.db.database} already has tables; schema left unchanged (use --reset to recreate).`);
    }
    await connection.end();

    // Seed encrypted demo notes through the same code path the API uses.
    const pool = (await import('../src/infra/db/mysql-client')).default;
    const { migrate } = await import('../src/infra/db/migrate');
    const created = await migrate();
    const { seedDemoCareTeam, seedDemoNotes } = await import('../src/services/demo-seed');
    const members = await seedDemoCareTeam(created.includes('patient_care_team'));
    if (members) console.log(`Seeded ${members} demo care-team memberships`);
    const seeded = await seedDemoNotes();
    console.log(seeded ? `Seeded ${seeded} encrypted demo therapy notes` : 'Therapy notes already present; demo notes not seeded.');

    await pool.end();
    console.log('Database ready. Accounts live in the AAA directory; demo logins: admin | psychiatrist | psychologist | therapist | nurse | patient / Demo@1234');
}

main().catch((error) => {
    console.error(`Database setup failed: ${error.message}`);
    process.exit(1);
});
