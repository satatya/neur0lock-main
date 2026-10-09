/**
 * Idempotent schema upgrades applied on API start-up, so databases created by an earlier version
 * (e.g. an existing Docker volume) pick up new tables without being re-initialised.
 */
import { config } from '../../config/env';
import { execute, queryOne } from './mysql-client';

const tableExists = async (table: string) =>
    Boolean(await queryOne('SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = ?', [config.db.database, table]));

/** Returns the tables created by this run. */
export async function migrate(): Promise<string[]> {
    const created: string[] = [];
    if (!(await tableExists('patient_care_team'))) {
        created.push('patient_care_team');
        await execute(`CREATE TABLE IF NOT EXISTS patient_care_team (
            patient_id BIGINT UNSIGNED NOT NULL,
            staff_id BIGINT UNSIGNED NOT NULL,
            reason VARCHAR(20) NOT NULL DEFAULT 'assigned',
            added_by BIGINT UNSIGNED NULL,
            added_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (patient_id, staff_id),
            INDEX idx_care_team_staff (staff_id),
            CONSTRAINT fk_care_team_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
            CONSTRAINT fk_care_team_staff FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
        ) ENGINE=InnoDB`);
        // Upgrading from a version without care teams: clinicians keep the patients they registered
        // (administrators see everyone anyway, so they are not added).
        const backfill = await execute(
            `INSERT IGNORE INTO patient_care_team (patient_id, staff_id, reason, added_by)
             SELECT p.id, p.created_by, 'created', p.created_by
             FROM patients p JOIN staff s ON s.id = p.created_by
             WHERE s.kind = 'staff' AND (s.role IS NULL OR s.role <> 'admin')`,
        );
        console.log(`[migrate] created patient_care_team (${backfill.affectedRows} registering clinician(s) kept on their patients' care teams)`);
    }
    return created;
}
