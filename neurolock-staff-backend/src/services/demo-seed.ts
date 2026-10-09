/**
 * Seeds the encrypted demo therapy notes when the notes table is empty. Runs on API startup
 * (SEED_DEMO=true) and from `npm run db:setup`; notes need the KEK, so SQL init scripts cannot add them.
 */
import { execute, queryOne } from '../infra/db/mysql-client';
import { createNote } from '../repositories/therapy-note.repository';

export async function seedDemoNotes(): Promise<number> {
    const noteCount = await queryOne<{ total: number }>('SELECT COUNT(*) AS total FROM therapy_notes');
    if (Number(noteCount?.total ?? 0) > 0) return 0;

    const staff = async (uid: string) => queryOne<{ id: number; name: string }>('SELECT id, name FROM staff WHERE uid = ?', [uid]);
    const patient = async (mrn: string) => (await queryOne<{ id: number }>('SELECT id FROM patients WHERE mrn = ?', [mrn]))?.id;
    const therapist = await staff('therapist');
    const psychiatrist = await staff('psychiatrist');
    const psychologist = await staff('psychologist');
    const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

    const demoNotes = [
        {
            mrn: 'MRN001', author: therapist, type: 'Individual Therapy', date: daysAgo(3),
            content: {
                mood: 'Anxious',
                symptoms: 'Reports improved sleep; worry about work deadlines persists.',
                interventions: 'Cognitive restructuring of catastrophic thoughts; paced breathing practice.',
                treatment_plan: 'Continue weekly CBT; introduce graded exposure to work tasks.',
                notes: 'Engaged well and completed homework log.',
                next_session: 'Next week, same time',
            },
        },
        {
            mrn: 'MRN001', author: psychiatrist, type: 'Consultation', date: daysAgo(10),
            content: {
                mood: 'Depressed',
                symptoms: 'Low mood, reduced appetite, no active suicidal ideation.',
                interventions: 'Medication review; psychoeducation on SSRI onset.',
                treatment_plan: 'Continue Sertraline 50mg; review in 2 weeks.',
                notes: 'Tolerating medication without significant side effects.',
            },
        },
        {
            mrn: 'MRN005', author: psychologist, type: 'Individual Therapy', date: daysAgo(7),
            content: {
                mood: 'Stable',
                symptoms: 'Checking rituals reduced from ~3h to ~2h per day.',
                interventions: 'Exposure and response prevention: contamination hierarchy level 3.',
                treatment_plan: 'Progress to level 4 exposures; Y-BOCS re-assessment scheduled.',
            },
        },
        {
            mrn: 'MRN003', author: therapist, type: 'Group Therapy', date: daysAgo(5),
            content: {
                mood: 'Withdrawn',
                symptoms: 'Hypervigilance in crowded settings; nightmares 2-3 times weekly.',
                interventions: 'Grounding techniques; group sharing.',
                notes: 'Participated actively after initial hesitation.',
            },
        },
    ];

    let seeded = 0;
    for (const note of demoNotes) {
        const patientId = await patient(note.mrn);
        if (!patientId || !note.author) continue;
        await createNote({
            patientId,
            authorId: note.author.id,
            author: note.author.name,
            noteType: note.type,
            sessionDate: note.date,
            content: note.content,
        });
        seeded += 1;
    }
    return seeded;
}

/**
 * Demo care teams beyond the attending physician / assigned therapist columns: the ward nurse looks
 * after the admitted patients, and the psychologist also follows Riya Jain (her assessments).
 * Runs on a fresh database (empty care-team table) or right after the table was added by an upgrade.
 */
export async function seedDemoCareTeam(tableJustCreated = false): Promise<number> {
    const existing = await queryOne<{ total: number }>('SELECT COUNT(*) AS total FROM patient_care_team');
    if (!tableJustCreated && Number(existing?.total ?? 0) > 0) return 0;
    const memberships: [string, string[]][] = [
        ['nurse', ['MRN001', 'MRN002', 'MRN004', 'MRN006']],
        ['psychologist', ['MRN001']],
    ];
    let added = 0;
    for (const [uid, mrns] of memberships) {
        const result = await execute(
            `INSERT IGNORE INTO patient_care_team (patient_id, staff_id, reason)
             SELECT p.id, s.id, 'assigned' FROM patients p JOIN staff s ON s.uid = ?
             WHERE p.mrn IN (${mrns.map(() => '?').join(',')})`,
            [uid, ...mrns],
        );
        added += result.affectedRows;
    }
    return added;
}
