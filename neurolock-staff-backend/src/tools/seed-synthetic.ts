/**
 * Synthetic demo data: realistic, randomised staff, patients and clinical history.
 *
 *   docker compose exec api node dist/tools/seed-synthetic.js      (Docker stack)
 *   npm run seed:synthetic                                          (local development)
 *
 * Options:  --per-role N   active accounts per role, patients included (default 6)
 *           --patients N   patient records in the clinic (default 48)
 *           --no-activity  skip the simulated sign-ins / record views of today
 *
 * Top-up semantics: every role is filled up to N accounts and the clinic up to N patients; history is
 * only generated for the patients created by this run, so running it again does not duplicate data.
 *  - Accounts are created through the AAA server (OpenLDAP), with the demo password.
 *  - Clinical history (medications, doses, vitals, appointments, sessions, assessments, alerts,
 *    encrypted notes) is written to MySQL with past dates.
 *  - "Today" activity goes through the real REST API, so the audit trail and rsyslog are genuine.
 */
import { config } from '../config/env';
import { aaa } from '../infra/aaa-client';
import pool, { execute, query, queryOne } from '../infra/db/mysql-client';
import { createPatient, nextMrn } from '../repositories/patient.repository';
import { createNote } from '../repositories/therapy-note.repository';
import { addToCareTeam } from '../services/care-scope';
import { mirrorAccount } from '../services/directory.service';

// ---------------------------------------------------------------------------- options
const argValue = (name: string, fallback: number) => {
    const index = process.argv.indexOf(name);
    const value = index >= 0 ? Number(process.argv[index + 1]) : NaN;
    return Number.isInteger(value) && value > 0 ? value : fallback;
};
const PER_ROLE = argValue('--per-role', 6);
const TARGET_PATIENTS = argValue('--patients', 48);
const ACTIVITY = !process.argv.includes('--no-activity');
const PASSWORD = process.env.SEED_PASSWORD || process.env.DEMO_PASSWORD || 'Demo@1234';
const ADMIN_USER = process.env.SEED_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || PASSWORD;
const API = `http://127.0.0.1:${config.port}/api`;
/** Accounts left behind by the automated smoke test; never given patients. */
const TEST_ACCOUNT = /^(smoke|ther|pat|link)\.[a-z0-9]{8}$/;

// ---------------------------------------------------------------------------- random helpers
const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const chance = (p: number) => Math.random() < p;
const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)];
const shuffle = <T>(items: readonly T[]): T[] => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
};
const sample = <T>(items: readonly T[], count: number) => shuffle(items).slice(0, Math.max(0, count));
const weighted = <T extends { weight: number }>(items: readonly T[]): T => {
    let roll = Math.random() * items.reduce((sum, item) => sum + item.weight, 0);
    for (const item of items) {
        roll -= item.weight;
        if (roll <= 0) return item;
    }
    return items[items.length - 1];
};
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const DAY = 86_400_000;
const daysAgo = (days: number, hourUtc = rand(3, 11), minute = pick([0, 30])) => {
    const date = new Date(Date.now() - days * DAY);
    date.setUTCHours(hourUtc, minute, 0, 0);
    return date;
};
const toSql = (date: Date) => date.toISOString().slice(0, 19).replace('T', ' ');
const toDate = (date: Date) => date.toISOString().slice(0, 10);
const phone = () => `+91-${pick(['9', '8', '7'])}${rand(1000, 9999)}-${rand(10000, 99999)}`;

// ---------------------------------------------------------------------------- name pools
const FEMALE = ['Aarohi', 'Ananya', 'Ishita', 'Kavya', 'Meghna', 'Nandini', 'Pooja', 'Priyanka', 'Riddhi', 'Sanya', 'Shreya', 'Tanvi', 'Diya', 'Neha', 'Aditi', 'Sneha', 'Lakshmi', 'Fatima', 'Zoya', 'Ritika', 'Pallavi', 'Divya', 'Anjali', 'Gauri', 'Mitali', 'Radhika', 'Swati', 'Varsha', 'Jasleen', 'Maria', 'Sana', 'Kritika'];
const MALE = ['Aarav', 'Aditya', 'Arjun', 'Dev', 'Harsh', 'Ishaan', 'Karan', 'Kabir', 'Manish', 'Nikhil', 'Pranav', 'Rahul', 'Rohan', 'Sahil', 'Siddharth', 'Tanmay', 'Varun', 'Vikrant', 'Yash', 'Imran', 'Farhan', 'Rajesh', 'Suresh', 'Anil', 'Gaurav', 'Mohit', 'Abhishek', 'Kunal', 'Joseph', 'Arnav', 'Omkar', 'Zubin'];
const SURNAMES = ['Sharma', 'Verma', 'Iyer', 'Menon', 'Nair', 'Reddy', 'Rao', 'Kulkarni', 'Deshpande', 'Joshi', 'Patil', 'Kapoor', 'Malhotra', 'Chatterjee', 'Banerjee', 'Mukherjee', 'Das', 'Ghosh', 'Singh', 'Gill', 'Khan', 'Qureshi', 'Fernandes', 'Pillai', 'Shetty', 'Bhat', 'Hegde', 'Agarwal', 'Gupta', 'Mehta', 'Shah', 'Desai', 'Naidu', 'Pandey', 'Mishra', 'Saxena', 'Sinha', 'Bose', 'Thomas', 'Kaur'];
const CITIES = [
    ['Pune', ['Baner Road', 'FC Road', 'Koregaon Park', 'Aundh']],
    ['Mumbai', ['Linking Road', 'Hill Road', 'LBS Marg', 'SV Road']],
    ['Bengaluru', ['MG Road', 'Indiranagar 100ft Rd', 'Jayanagar 4th Block', 'HSR Layout']],
    ['Chennai', ['Anna Salai', 'TTK Road', 'Besant Nagar', 'Velachery Main Rd']],
    ['Hyderabad', ['Banjara Hills Rd 12', 'Jubilee Hills', 'Madhapur', 'Begumpet']],
    ['Kolkata', ['Park Street', 'Salt Lake Sector V', 'Ballygunge', 'Gariahat Rd']],
    ['Kochi', ['MG Road', 'Panampilly Nagar', 'Kakkanad', 'Edappally']],
    ['Ahmedabad', ['CG Road', 'SG Highway', 'Navrangpura', 'Satellite Rd']],
] as const;
const INSURERS = ['Star Health', 'HDFC Ergo', 'ICICI Lombard', 'Bajaj Allianz', 'Niva Bupa', 'Care Health', 'Ayushman Bharat (PM-JAY)', 'Self-pay'];
const ALLERGIES = ['Penicillin', 'Sulfa drugs', 'Latex', 'Aspirin', 'NSAIDs', 'Peanuts', 'Iodine contrast'];
const RELATIONS = ['Mother', 'Father', 'Spouse', 'Brother', 'Sister', 'Son', 'Daughter', 'Friend'];

// ---------------------------------------------------------------------------- clinical profiles
interface MedSpec {
    name: string;
    dose: string;
    frequency: string;
    times: string | null;
    instructions?: string;
}
interface Scale {
    type: string;
    min: number;
    max: number;
    decimals?: boolean;
}
interface Profile {
    dx: string;
    weight: number;
    ward: string;
    inpatientRate: number;
    therapy: 'psychologist' | 'therapist' | 'either' | 'none';
    meds: MedSpec[];
    scales: Scale[];
    moods: string[];
    symptoms: string[];
    interventions: string[];
    plans: string[];
}

const PROFILES: Profile[] = [
    {
        dx: 'Major Depressive Disorder', weight: 18, ward: 'Ward A', inpatientRate: 0.35, therapy: 'either',
        meds: [
            { name: 'Sertraline', dose: '50mg', frequency: 'Once daily', times: '08:00', instructions: 'Take with breakfast' },
            { name: 'Escitalopram', dose: '10mg', frequency: 'Once daily', times: '08:00' },
            { name: 'Mirtazapine', dose: '15mg', frequency: 'At night', times: '21:00', instructions: 'May cause drowsiness' },
            { name: 'Bupropion XL', dose: '150mg', frequency: 'Once daily', times: '08:00' },
        ],
        scales: [{ type: 'PHQ-9', min: 6, max: 24 }, { type: 'Beck Depression Inventory (BDI-II)', min: 12, max: 42 }],
        moods: ['Low', 'Flat', 'Tearful', 'Slightly brighter', 'Improving'],
        symptoms: ['Low mood most of the day with early-morning waking.', 'Anhedonia and reduced appetite; denies active suicidal ideation.', 'Fatigue and poor concentration affecting work.', 'Feelings of worthlessness; sleep improving with medication.'],
        interventions: ['Behavioural activation: weekly activity schedule reviewed.', 'CBT cognitive restructuring of self-critical thoughts.', 'Safety plan reviewed and updated.'],
        plans: ['Continue weekly CBT; add one pleasant activity per day.', 'Review SSRI response in 2 weeks.', 'Repeat PHQ-9 at next visit.'],
    },
    {
        dx: 'Generalized Anxiety Disorder', weight: 12, ward: 'Ward A', inpatientRate: 0.1, therapy: 'psychologist',
        meds: [
            { name: 'Escitalopram', dose: '10mg', frequency: 'Once daily', times: '08:00' },
            { name: 'Buspirone', dose: '10mg', frequency: 'Twice daily', times: '08:00,20:00' },
            { name: 'Propranolol', dose: '10mg', frequency: 'As needed', times: null, instructions: 'For palpitations, max 3 per day' },
        ],
        scales: [{ type: 'GAD-7', min: 7, max: 19 }, { type: 'Hamilton Anxiety Rating Scale (HAM-A)', min: 12, max: 30 }],
        moods: ['Anxious', 'Tense', 'Restless', 'Calmer'],
        symptoms: ['Persistent worry about work and family; muscle tension.', 'Difficulty falling asleep due to racing thoughts.', 'Occasional palpitations before meetings.'],
        interventions: ['Worry time and postponement technique.', 'Progressive muscle relaxation practised in session.', 'Cognitive restructuring of catastrophic predictions.'],
        plans: ['Daily relaxation practice; worry log.', 'Graded exposure to avoided situations.', 'Review GAD-7 in 4 weeks.'],
    },
    {
        dx: 'Bipolar I Disorder', weight: 9, ward: 'Ward B', inpatientRate: 0.55, therapy: 'therapist',
        meds: [
            { name: 'Lithium Carbonate', dose: '300mg', frequency: 'Twice daily', times: '08:00,20:00', instructions: 'Check serum lithium weekly' },
            { name: 'Sodium Valproate', dose: '500mg', frequency: 'Twice daily', times: '08:00,20:00' },
            { name: 'Quetiapine', dose: '100mg', frequency: 'At night', times: '21:00' },
        ],
        scales: [{ type: 'Young Mania Rating Scale (YMRS)', min: 4, max: 30 }, { type: 'PHQ-9', min: 3, max: 16 }],
        moods: ['Elevated', 'Irritable', 'Euthymic', 'Stable'],
        symptoms: ['Reduced need for sleep and pressured speech last week, settling now.', 'Euthymic; insight improving.', 'Mild irritability; adherent to mood stabiliser.'],
        interventions: ['Psychoeducation on early warning signs.', 'Mood charting reviewed.', 'Family psychoeducation session.'],
        plans: ['Continue mood stabiliser; lithium level on Monday.', 'Maintain regular sleep schedule.', 'Relapse signature plan to be shared with family.'],
    },
    {
        dx: 'Schizophrenia', weight: 8, ward: 'Ward C', inpatientRate: 0.65, therapy: 'therapist',
        meds: [
            { name: 'Risperidone', dose: '2mg', frequency: 'Twice daily', times: '09:00,21:00' },
            { name: 'Olanzapine', dose: '10mg', frequency: 'At night', times: '21:00' },
            { name: 'Aripiprazole', dose: '15mg', frequency: 'Once daily', times: '09:00' },
            { name: 'Trihexyphenidyl', dose: '2mg', frequency: 'Once daily', times: '09:00', instructions: 'For extrapyramidal side effects' },
        ],
        scales: [{ type: 'PANSS', min: 58, max: 105 }, { type: 'Brief Psychiatric Rating Scale (BPRS)', min: 32, max: 64 }],
        moods: ['Guarded', 'Withdrawn', 'Calm', 'Engaged'],
        symptoms: ['Auditory hallucinations reduced in frequency.', 'Some persecutory ideas, less preoccupied than on admission.', 'Improved self-care; attending ward activities.'],
        interventions: ['Supportive therapy and reality orientation.', 'Medication adherence counselling.', 'Social skills group.'],
        plans: ['Continue antipsychotic; monitor metabolic profile.', 'Occupational therapy referral.', 'Plan family meeting before discharge.'],
    },
    {
        dx: 'Post-Traumatic Stress Disorder', weight: 7, ward: 'Ward A', inpatientRate: 0.1, therapy: 'psychologist',
        meds: [
            { name: 'Sertraline', dose: '100mg', frequency: 'Once daily', times: '08:00' },
            { name: 'Prazosin', dose: '1mg', frequency: 'At night', times: '21:00', instructions: 'For nightmares; check BP' },
        ],
        scales: [{ type: 'PCL-5', min: 28, max: 62 }],
        moods: ['Hypervigilant', 'Anxious', 'Withdrawn', 'Calmer'],
        symptoms: ['Nightmares 2-3 times per week; startle response.', 'Avoids crowded places; intrusive memories reduced.', 'Sleep improving with prazosin.'],
        interventions: ['Trauma-focused CBT: trauma narrative continued.', 'Grounding techniques practised.', 'Prolonged exposure homework reviewed.'],
        plans: ['Continue TF-CBT weekly.', 'In-vivo exposure hierarchy step 3.', 'Repeat PCL-5 in 4 weeks.'],
    },
    {
        dx: 'Obsessive-Compulsive Disorder', weight: 7, ward: 'Ward A', inpatientRate: 0.05, therapy: 'psychologist',
        meds: [
            { name: 'Fluoxetine', dose: '40mg', frequency: 'Once daily', times: '08:00' },
            { name: 'Fluvoxamine', dose: '100mg', frequency: 'At night', times: '21:00' },
        ],
        scales: [{ type: 'Y-BOCS', min: 14, max: 32 }],
        moods: ['Anxious', 'Frustrated', 'Hopeful'],
        symptoms: ['Checking rituals about 2 hours per day, down from 3.', 'Contamination fears; hand-washing reduced.', 'Intrusive thoughts less distressing.'],
        interventions: ['Exposure and response prevention, hierarchy level 3.', 'Cognitive work on inflated responsibility.', 'Family accommodation discussed.'],
        plans: ['ERP homework daily.', 'Progress to level 4 exposures.', 'Re-assess Y-BOCS next month.'],
    },
    {
        dx: 'Alcohol Use Disorder', weight: 8, ward: 'Ward D', inpatientRate: 0.5, therapy: 'therapist',
        meds: [
            { name: 'Naltrexone', dose: '50mg', frequency: 'Once daily', times: '10:00' },
            { name: 'Acamprosate', dose: '333mg', frequency: 'Three times daily', times: '08:00,14:00,20:00' },
            { name: 'Thiamine', dose: '100mg', frequency: 'Once daily', times: '10:00' },
            { name: 'Chlordiazepoxide', dose: '10mg', frequency: 'Three times daily', times: '08:00,14:00,20:00', instructions: 'Withdrawal taper; hold if drowsy' },
        ],
        scales: [{ type: 'AUDIT', min: 16, max: 34 }, { type: 'CIWA-Ar', min: 3, max: 18 }],
        moods: ['Irritable', 'Motivated', 'Ambivalent', 'Stable'],
        symptoms: ['Withdrawal symptoms settling; no tremor today.', 'Cravings in the evening, managed with coping plan.', 'Sleep disturbed but improving.'],
        interventions: ['Motivational interviewing: decisional balance.', 'Relapse prevention: high-risk situations mapped.', 'Referral to AA group discussed.'],
        plans: ['Continue naltrexone; LFTs in 2 weeks.', 'Daily craving log.', 'Family session on support at home.'],
    },
    {
        dx: 'Panic Disorder', weight: 5, ward: 'Ward A', inpatientRate: 0.05, therapy: 'psychologist',
        meds: [
            { name: 'Sertraline', dose: '50mg', frequency: 'Once daily', times: '08:00' },
            { name: 'Clonazepam', dose: '0.25mg', frequency: 'Twice daily', times: '08:00,20:00', instructions: 'Short-term; taper planned' },
        ],
        scales: [{ type: 'Panic Disorder Severity Scale (PDSS)', min: 7, max: 20 }],
        moods: ['Anxious', 'Apprehensive', 'Calmer'],
        symptoms: ['Two panic attacks this week, shorter duration.', 'Avoids metro travel; anticipatory anxiety.', 'Fewer ED visits since starting treatment.'],
        interventions: ['Interoceptive exposure exercises.', 'Breathing retraining.', 'Cognitive model of panic reviewed.'],
        plans: ['Graded exposure to metro travel.', 'Plan clonazepam taper.', 'Repeat PDSS next session.'],
    },
    {
        dx: 'Attention-Deficit/Hyperactivity Disorder (adult)', weight: 4, ward: 'Ward A', inpatientRate: 0, therapy: 'psychologist',
        meds: [{ name: 'Atomoxetine', dose: '40mg', frequency: 'Once daily', times: '08:00' }],
        scales: [{ type: 'ASRS v1.1', min: 12, max: 22 }],
        moods: ['Restless', 'Motivated', 'Frustrated'],
        symptoms: ['Missing deadlines at work; forgetful.', 'Improved focus since atomoxetine started.', 'Procrastination on long tasks.'],
        interventions: ['Organisation and planning skills.', 'Task-chunking and timers.', 'Psychoeducation on ADHD.'],
        plans: ['Use planner app daily.', 'Review medication response in 4 weeks.', 'Coaching sessions fortnightly.'],
    },
    {
        dx: 'Borderline Personality Disorder', weight: 4, ward: 'Ward B', inpatientRate: 0.25, therapy: 'therapist',
        meds: [{ name: 'Quetiapine', dose: '25mg', frequency: 'At night', times: '21:00' }],
        scales: [{ type: 'Difficulties in Emotion Regulation Scale (DERS)', min: 92, max: 140 }],
        moods: ['Labile', 'Distressed', 'Settled'],
        symptoms: ['Emotional dysregulation after conflict with partner.', 'No self-harm this week; urges managed with skills.', 'Fear of abandonment discussed.'],
        interventions: ['DBT skills: distress tolerance (TIPP).', 'Chain analysis of last crisis.', 'Validation and emotion labelling.'],
        plans: ['Continue DBT group weekly.', 'Diary card daily.', 'Crisis plan reviewed with patient.'],
    },
    {
        dx: 'Anorexia Nervosa', weight: 2, ward: 'Ward B', inpatientRate: 0.4, therapy: 'psychologist',
        meds: [{ name: 'Olanzapine', dose: '2.5mg', frequency: 'At night', times: '21:00' }],
        scales: [{ type: 'EDE-Q (global)', min: 2.6, max: 5.2, decimals: true }],
        moods: ['Anxious', 'Low', 'Engaged'],
        symptoms: ['Weight stable this week; meal plan 80% completed.', 'Body image distress after meals.', 'Engaging in supported meals.'],
        interventions: ['CBT-E: regular eating pattern.', 'Motivational work on recovery goals.', 'Dietitian liaison.'],
        plans: ['Weekly weight check.', 'Continue supported meals.', 'Family-based session next week.'],
    },
];
const SECONDARY = ['Insomnia', 'Generalized Anxiety Disorder', 'Social Anxiety Disorder', 'Alcohol Use Disorder', 'Hypothyroidism', 'Type 2 Diabetes', 'Hypertension', 'Migraine', 'Tobacco Use Disorder'];
const SESSION_SUMMARIES = [
    'Reviewed homework; good engagement.',
    'Explored triggers from the past week; practised coping skills.',
    'Worked on cognitive restructuring of automatic thoughts.',
    'Discussed medication side effects and adherence.',
    'Family dynamics explored; plan for family session.',
    'Practised grounding and breathing techniques.',
    'Set SMART goals for the coming week.',
    'Relapse prevention plan updated.',
    'Processed a difficult event at work; adaptive coping noted.',
    'Patient reported better sleep and routine.',
];
const ALERTS: Record<string, { priority: 'low' | 'medium' | 'high'; messages: string[] }> = {
    medication: { priority: 'high', messages: ['Refused morning dose; doctor informed', 'Serum drug level due today', 'Review sedation after dose increase'] },
    vitals: { priority: 'medium', messages: ['BP elevated on last two readings', 'Tachycardia overnight; recheck at 10:00', 'Low SpO2 reading; repeat with new probe'] },
    behaviour: { priority: 'medium', messages: ['Agitated during evening round; de-escalated verbally', 'Not eating well; monitor intake chart', 'Withdrawn, staying in room most of the day'] },
    safety: { priority: 'high', messages: ['Increased suicide risk; 15-minute observations', 'Absconding risk; escort when off the ward'] },
    lab: { priority: 'low', messages: ['LFT results pending', 'CBC results available for review', 'Thyroid profile due this week'] },
    general: { priority: 'low', messages: ['Family meeting scheduled for Friday', 'Discharge planning: social worker to review', 'Occupational therapy assessment booked'] },
};

// ---------------------------------------------------------------------------- staff roles
const STAFF_ROLES = ['admin', 'psychiatrist', 'psychologist', 'therapist', 'nurse'] as const;
type StaffRole = (typeof STAFF_ROLES)[number];
const LICENCE: Record<StaffRole, (() => string) | null> = {
    admin: null,
    psychiatrist: () => `NMC-MH-${rand(2006, 2020)}-${rand(10000, 99999)}`,
    psychologist: () => `RCI-A${rand(10000, 99999)}`,
    therapist: () => `RCI-B${rand(10000, 99999)}`,
    nurse: () => `INC-RN-${rand(100000, 999999)}`,
};

interface Person {
    id: number;
    uid: string;
    name: string;
    email: string | null;
    role: string;
}

interface Account {
    uid: string;
    name: string;
    email: string | null;
    base_role: string | null;
    base_role_name: string | null;
    status: string;
    kind: 'staff' | 'patient';
}

const counts: Record<string, number> = {};
const bump = (key: string, by = 1) => {
    counts[key] = (counts[key] ?? 0) + by;
};

// ---------------------------------------------------------------------------- AAA / API helpers
async function aaaLogin(identifier: string, password: string): Promise<{ token: string; user: Account }> {
    const { data } = await aaa<any>('POST', '/auth/login', { token: null, body: { identifier, password } });
    if (data?.mfa_required) throw new Error(`${identifier} uses MFA and cannot be signed in automatically`);
    return { token: data.token, user: data.user };
}
const aaaStepUp = async (token: string, password = PASSWORD) =>
    (await aaa<{ step_up_token: string }>('POST', '/auth/step-up', { token, body: { password } })).data.step_up_token;

async function api(method: string, path: string, token: string | null, body?: unknown, stepUp?: string) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'User-Agent': 'NeuroLock-synthetic/1.0' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (stepUp) headers['X-Step-Up-Token'] = stepUp;
    const response = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
}

const usernames = new Set<string>();
function username(first: string, last: string) {
    const base = `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, '');
    let candidate = base;
    for (let n = 2; usernames.has(candidate); n += 1) candidate = `${base}${n}`;
    usernames.add(candidate);
    return candidate;
}
function personName(gender: 'Female' | 'Male') {
    const last = pick(SURNAMES);
    // Kaur is a women's surname; Sikh men are Singh
    return { first: pick(gender === 'Female' ? FEMALE : MALE), last: last === 'Kaur' && gender === 'Male' ? 'Singh' : last };
}

// ---------------------------------------------------------------------------- 1. staff accounts
async function topUpStaff(adminToken: string, adminStepUp: string, accounts: Account[]) {
    for (const role of STAFF_ROLES) {
        const active = accounts.filter((a) => a.base_role === role && a.status === 'active' && !TEST_ACCOUNT.test(a.uid)).length;
        for (let i = active; i < PER_ROLE; i += 1) {
            const gender = chance(0.55) ? 'Female' : 'Male';
            const { first, last } = personName(gender);
            const uid = username(first, last);
            const doctor = role === 'psychiatrist' || role === 'psychologist';
            const name = `${doctor ? 'Dr. ' : ''}${first} ${last}`;
            await aaa('POST', '/users', {
                token: adminToken,
                stepUp: role === 'admin' ? adminStepUp : undefined,
                body: { username: uid, name, email: `${uid}@neurolock.com`, phone: phone(), role, password: PASSWORD, licence_number: LICENCE[role]?.() ?? undefined },
            });
            bump(`accounts: ${role}`);
        }
    }
}

/** Active staff by role, with their MySQL directory-mirror ids (clinical records reference these). */
async function loadRoster(accounts: Account[]) {
    const roster: Record<string, Person[]> = {};
    for (const account of accounts) {
        if (account.kind !== 'staff' || account.status !== 'active' || !account.base_role) continue;
        const id = await mirrorAccount({ uid: account.uid, name: account.name, email: account.email, role: account.base_role, role_name: account.base_role_name, kind: 'staff' });
        if (TEST_ACCOUNT.test(account.uid)) continue;
        (roster[account.base_role] = roster[account.base_role] ?? []).push({ id, uid: account.uid, name: account.name, email: account.email, role: account.base_role });
    }
    return roster;
}

// ---------------------------------------------------------------------------- 2. patients + history
interface NewPatient {
    id: number;
    name: string;
    gender: 'Female' | 'Male';
    first: string;
    last: string;
    email: string | null;
    phone: string;
    profile: Profile;
    inpatient: boolean;
    critical: boolean;
    attending: Person;
    lead: Person | null;
    nurses: Person[];
    extra: Person | null;
    since: number; // days in care
}

function roundRobin<T>(items: T[]) {
    let index = 0;
    const order = shuffle(items);
    return () => order[index++ % order.length];
}

async function createPatients(roster: Record<string, Person[]>): Promise<NewPatient[]> {
    const existing = Number((await queryOne<{ total: number }>('SELECT COUNT(*) AS total FROM patients'))?.total ?? 0);
    const needed = Math.max(0, TARGET_PATIENTS - existing);
    const psychiatrists = roster.psychiatrist ?? [];
    const psychologists = roster.psychologist ?? [];
    const therapists = roster.therapist ?? [];
    const nurses = roster.nurse ?? [];
    if (!psychiatrists.length) throw new Error('No active psychiatrist to attend patients');
    const nextPsychiatrist = roundRobin(psychiatrists);
    const nextPsychologist = psychologists.length ? roundRobin(psychologists) : null;
    const nextTherapist = therapists.length ? roundRobin(therapists) : null;
    // Each ward has its own nurses
    const wards = ['Ward A', 'Ward B', 'Ward C', 'Ward D'];
    const wardNurses: Record<string, Person[]> = Object.fromEntries(wards.map((ward) => [ward, [] as Person[]]));
    shuffle(nurses).forEach((nurse, index) => wardNurses[wards[index % wards.length]].push(nurse));
    const roomCounters: Record<string, number> = {};

    const created: NewPatient[] = [];
    for (let i = 0; i < needed; i += 1) {
        const profile = weighted(PROFILES);
        const gender = chance(0.5) ? 'Female' : 'Male';
        const { first, last } = personName(gender);
        const inpatient = chance(profile.inpatientRate);
        const critical = inpatient && chance(0.18);
        const discharged = !inpatient && chance(0.1);
        const since = inpatient ? rand(3, 40) : rand(20, 200);
        const [city, streets] = pick(CITIES);
        const relation = pick(RELATIONS);
        const relative = personName(['Mother', 'Sister', 'Daughter'].includes(relation) ? 'Female' : ['Father', 'Brother', 'Son'].includes(relation) ? 'Male' : pick(['Female', 'Male'] as const));
        const attending = nextPsychiatrist();
        const leadPool =
            profile.therapy === 'none' ? null : profile.therapy === 'psychologist' ? nextPsychologist ?? nextTherapist : profile.therapy === 'therapist' ? nextTherapist ?? nextPsychologist : chance(0.5) ? nextPsychologist ?? nextTherapist : nextTherapist ?? nextPsychologist;
        const lead = leadPool && chance(0.88) ? leadPool() : null;
        const ward = inpatient ? profile.ward : null;
        roomCounters[ward ?? ''] = (roomCounters[ward ?? ''] ?? 100) + rand(1, 3);
        const contact = phone();
        const email = chance(0.75) ? `${first}.${last}${rand(1, 99)}@example.org`.toLowerCase() : null;
        const id = await createPatient(
            {
                mrn: await nextMrn(),
                full_name: `${first} ${last}`,
                dob: toDate(new Date(Date.now() - rand(18 * 365, 72 * 365) * DAY)),
                gender,
                phone: contact,
                email,
                address: `${rand(2, 220)} ${pick(streets)}, ${city}`,
                emergency_contact_name: `${relative.first} ${relation === 'Friend' ? relative.last : last} (${relation})`,
                emergency_contact_phone: phone(),
                insurance: pick(INSURERS),
                allergies: chance(0.25) ? pick(ALLERGIES) : null,
                primary_diagnosis: profile.dx,
                secondary_diagnosis: chance(0.3) ? pick(SECONDARY.filter((dx) => dx !== profile.dx)) : null,
                ward,
                room: ward ? `${ward.slice(-1)}-${roomCounters[ward]}` : null,
                status: discharged ? 'discharged' : critical ? 'critical' : chance(0.05) ? 'inactive' : 'active',
                priority: critical ? 'high' : inpatient ? pick(['high', 'medium', 'medium']) : pick(['low', 'medium', 'low']),
                attending_physician_id: attending.id,
                assigned_therapist_id: lead?.id ?? null,
                admission_date: inpatient ? toDate(new Date(Date.now() - since * DAY)) : null,
            },
            attending.id,
        );
        await execute('UPDATE patients SET created_at = ? WHERE id = ?', [toSql(daysAgo(since)), id]);
        const careNurses = ward ? sample(wardNurses[ward], rand(1, 2)) : [];
        for (const nurse of careNurses) await addToCareTeam(id, nurse.id, 'assigned', attending.id);
        // Sometimes a psychologist assesses a patient whose lead is a therapist
        const extra = lead?.role === 'therapist' && nextPsychologist && chance(0.3) ? nextPsychologist() : null;
        if (extra) await addToCareTeam(id, extra.id, 'assigned', attending.id);
        created.push({ id, name: `${first} ${last}`, gender, first, last, email, phone: contact, profile, inpatient, critical, attending, lead, nurses: careNurses, extra, since });
        bump('patients');
    }
    return created;
}

const busy = new Set<string>();
function freeSlot(staffId: number, date: Date) {
    for (let tries = 0; tries < 12; tries += 1) {
        const key = `${staffId}|${date.toISOString()}`;
        if (!busy.has(key)) {
            busy.add(key);
            return date;
        }
        date = new Date(date.getTime() + 60 * 60_000);
    }
    return date;
}

async function seedHistory(patient: NewPatient) {
    const { profile, attending, lead } = patient;
    const nurse = patient.nurses[0] ?? null;

    // Medications (+ dose administrations for inpatients)
    const meds = sample(profile.meds, patient.inpatient ? rand(2, Math.min(3, profile.meds.length)) : rand(1, Math.min(2, profile.meds.length)));
    for (const med of meds) {
        const roll = Math.random();
        const status = roll < 0.08 ? 'discontinued' : roll < 0.13 ? 'on_hold' : 'active';
        const start = daysAgo(Math.max(1, patient.since - rand(0, 3)));
        const result = await execute(
            `INSERT INTO medications (patient_id, name, dose, frequency, route, scheduled_times, instructions, start_date, end_date, status, prescribed_by, created_at)
             VALUES (?, ?, ?, ?, 'Oral', ?, ?, ?, ?, ?, ?, ?)`,
            [patient.id, med.name, med.dose, med.frequency, med.times, med.instructions ?? null, toDate(start), status === 'discontinued' ? toDate(daysAgo(rand(1, 5))) : null, status, attending.id, toSql(start)],
        );
        bump('medications');
        if (patient.inpatient && nurse && status === 'active' && med.times) {
            for (let day = Math.min(3, patient.since); day >= 0; day -= 1) {
                for (const time of med.times.split(',')) {
                    const [hh, mm] = time.split(':').map(Number);
                    const slot = new Date(Date.now() - day * DAY);
                    slot.setUTCHours(hh - 5, mm - 30 + rand(0, 40), 0, 0); // ward clock is IST (UTC+5:30)
                    if (slot.getTime() > Date.now()) continue;
                    const outcome = weighted([
                        { status: 'given', weight: 88 },
                        { status: 'refused', weight: 5 },
                        { status: 'held', weight: 4 },
                        { status: 'missed', weight: 3 },
                    ]).status;
                    await execute(
                        `INSERT INTO medication_administrations (medication_id, patient_id, schedule_date, scheduled_time, administered_by, administered_at, status, notes)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                        [result.insertId, patient.id, toDate(new Date(Date.now() - day * DAY)), time, pick(patient.nurses).id, toSql(slot), outcome, outcome === 'given' ? null : pick(['Patient declined', 'Drowsy, held per protocol', 'Off ward at slot time'])],
                    );
                    bump('dose records');
                }
            }
        }
    }

    // Vitals
    const baseHr = rand(66, 88) + (patient.critical ? 14 : 0);
    const baseSys = rand(108, 132) + (patient.critical ? 10 : 0);
    const readings = patient.inpatient ? Math.min(patient.since, 6) * 2 + 1 : rand(1, 3);
    for (let r = 0; r < readings; r += 1) {
        const when = patient.inpatient ? new Date(Date.now() - r * 12 * 3_600_000 - rand(0, 90) * 60_000) : daysAgo(rand(1, patient.since));
        const recorder = patient.nurses.length ? pick(patient.nurses) : nurse ?? attending;
        await execute(
            `INSERT INTO vitals (patient_id, recorded_by, recorded_at, heart_rate, bp_systolic, bp_diastolic, temperature_c, respiratory_rate, spo2, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [patient.id, recorder.id, toSql(when), baseHr + rand(-6, 8), baseSys + rand(-8, 10), rand(70, 90), (36.4 + Math.random() * 0.9).toFixed(1), rand(13, 19), rand(95, 99), chance(0.1) ? pick(['Post-medication check', 'Patient anxious during reading', 'Repeat after rest']) : null],
        );
        bump('vital signs');
    }

    // Appointments, therapy sessions and progress
    const pastSessions: Date[] = [];
    let score = rand(22, 45);
    if (lead) {
        const weeks = Math.min(8, Math.max(2, Math.floor(patient.since / 7)));
        for (let w = weeks; w >= 1; w -= 1) {
            const when = freeSlot(lead.id, daysAgo(w * 7 + rand(-1, 1)));
            const status = weighted([
                { status: 'completed', weight: 82 },
                { status: 'no_show', weight: 7 },
                { status: 'cancelled', weight: 11 },
            ]).status;
            const type = lead.role === 'psychologist' && w === weeks ? 'Assessment' : 'Therapy session';
            await execute(
                `INSERT INTO appointments (patient_id, staff_id, scheduled_at, duration_min, appointment_type, reason, status, created_by, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [patient.id, lead.id, toSql(when), type === 'Assessment' ? 60 : 50, type, pick(profile.interventions).split(':')[0], status, lead.id, toSql(new Date(when.getTime() - rand(3, 14) * DAY))],
            );
            bump('appointments');
            if (status !== 'completed') continue;
            score = clamp(score + rand(-3, 9), 5, 95);
            const sessionType = weighted([
                { t: 'Individual', weight: 80 },
                { t: 'Group', weight: 12 },
                { t: 'Family', weight: 8 },
            ]).t;
            const summary = pick(SESSION_SUMMARIES);
            await execute(
                `INSERT INTO therapy_sessions (patient_id, clinician_id, session_date, duration_min, session_type, summary, progress_score, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [patient.id, lead.id, toDate(when), sessionType === 'Group' ? 90 : 50, sessionType, summary, score, toSql(when)],
            );
            await execute('INSERT INTO patient_progress (patient_id, score, note, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?)', [patient.id, score, summary, lead.id, toSql(when)]);
            pastSessions.push(when);
            bump('therapy sessions');
        }
        if (patient.since >= 0 && chance(0.85)) {
            for (let n = 0; n < rand(1, 2); n += 1) {
                const when = freeSlot(lead.id, daysAgo(-rand(1, 21)));
                await execute(
                    `INSERT INTO appointments (patient_id, staff_id, scheduled_at, duration_min, appointment_type, reason, status, created_by)
                     VALUES (?, ?, ?, 50, 'Therapy session', 'Weekly session', 'scheduled', ?)`,
                    [patient.id, lead.id, toSql(when), lead.id],
                );
                bump('appointments');
            }
        }
    }
    // Psychiatrist reviews
    for (let n = 0; n < rand(1, 3); n += 1) {
        const days = rand(1, Math.max(2, patient.since));
        const when = freeSlot(attending.id, daysAgo(days));
        await execute(
            `INSERT INTO appointments (patient_id, staff_id, scheduled_at, duration_min, appointment_type, reason, status, created_by, created_at)
             VALUES (?, ?, ?, 30, ?, ?, ?, ?, ?)`,
            [patient.id, attending.id, toSql(when), pick(['Medication review', 'Follow-up', 'Consultation']), `${profile.dx} review`, chance(0.9) ? 'completed' : 'no_show', attending.id, toSql(new Date(when.getTime() - 7 * DAY))],
        );
        bump('appointments');
    }
    if (chance(0.7)) {
        const when = freeSlot(attending.id, daysAgo(-rand(1, 28)));
        await execute(
            `INSERT INTO appointments (patient_id, staff_id, scheduled_at, duration_min, appointment_type, reason, status, created_by)
             VALUES (?, ?, ?, 30, 'Medication review', ?, 'scheduled', ?)`,
            [patient.id, attending.id, toSql(when), `Review ${meds[0]?.name ?? 'treatment'}`, attending.id],
        );
        bump('appointments');
    }

    // Assessments (scores fall as treatment works)
    const assessor = patient.extra ?? (lead?.role === 'psychologist' ? lead : attending);
    for (const scale of sample(profile.scales, rand(1, profile.scales.length))) {
        const span = scale.max - scale.min;
        const baseline = scale.min + span * (0.55 + Math.random() * 0.45);
        const points = [{ days: Math.max(2, patient.since - rand(0, 2)), value: baseline }];
        if (patient.since > 21 && chance(0.7)) points.push({ days: rand(2, 10), value: baseline - span * (0.15 + Math.random() * 0.3) });
        for (const point of points) {
            const value = clamp(point.value, scale.min * 0.6, scale.max);
            await execute(
                `INSERT INTO assessments (patient_id, assessment_type, scheduled_by, scheduled_by_id, status, scheduled_date, score, notes, created_at)
                 VALUES (?, ?, ?, ?, 'completed', ?, ?, ?, ?)`,
                [patient.id, scale.type, assessor.email ?? assessor.uid, assessor.id, toDate(daysAgo(point.days)), scale.decimals ? value.toFixed(1) : String(Math.round(value)), point === points[0] ? 'Baseline' : 'Follow-up: improvement noted', toSql(daysAgo(point.days + 2))],
            );
            bump('assessments');
        }
        if (chance(0.5)) {
            await execute(
                `INSERT INTO assessments (patient_id, assessment_type, scheduled_by, scheduled_by_id, status, scheduled_date, notes)
                 VALUES (?, ?, ?, ?, ?, ?, 'Scheduled re-assessment')`,
                [patient.id, scale.type, assessor.email ?? assessor.uid, assessor.id, chance(0.7) ? 'scheduled' : 'pending', toDate(daysAgo(-rand(2, 20)))],
            );
            bump('assessments');
        }
    }

    // Care alerts
    if (patient.inpatient) {
        const alerts = rand(0, patient.critical ? 3 : 2);
        for (let n = 0; n < alerts; n += 1) {
            const category = patient.critical && n === 0 ? 'safety' : pick(Object.keys(ALERTS));
            const spec = ALERTS[category];
            const created = new Date(Date.now() - rand(1, 72) * 3_600_000);
            const acknowledged = chance(0.45);
            const by = patient.nurses.length ? pick(patient.nurses) : attending;
            await execute(
                `INSERT INTO patient_alerts (patient_id, message, priority, category, created_by, created_at, acknowledged_by, acknowledged_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [patient.id, pick(spec.messages), spec.priority, category, by.id, toSql(created), acknowledged ? attending.id : null, acknowledged ? toSql(new Date(created.getTime() + rand(1, 8) * 3_600_000)) : null],
            );
            bump('care alerts');
        }
    }

    // Encrypted therapy notes
    const authors: { who: Person; when: Date; type: string }[] = [];
    for (const when of sample(pastSessions, rand(1, 3))) authors.push({ who: lead as Person, when, type: lead?.role === 'psychologist' ? 'Individual Therapy' : pick(['Session Note', 'Individual Therapy', 'Progress Note']) });
    if (chance(0.45)) authors.push({ who: attending, when: daysAgo(rand(1, Math.max(2, patient.since))), type: 'Consultation' });
    for (const note of authors) {
        const id = await createNote({
            patientId: patient.id,
            authorId: note.who.id,
            author: note.who.name,
            noteType: note.type,
            sessionDate: toDate(note.when),
            content: {
                mood: pick(profile.moods),
                symptoms: pick(profile.symptoms),
                interventions: pick(profile.interventions),
                treatment_plan: pick(profile.plans),
                notes: pick(SESSION_SUMMARIES),
                next_session: chance(0.6) ? pick(['Next week, same time', 'In two weeks', 'After the medication review']) : undefined,
            },
        });
        await execute('UPDATE therapy_notes SET created_at = ?, updated_at = ? WHERE id = ?', [toSql(note.when), toSql(note.when), id]);
        bump('encrypted therapy notes');
    }
}

// ---------------------------------------------------------------------------- 3. patient portal accounts
async function topUpPortalAccounts(adminToken: string, accounts: Account[], created: NewPatient[]) {
    const active = accounts.filter((a) => a.base_role === 'patient' && a.status === 'active' && !TEST_ACCOUNT.test(a.uid)).length;
    const candidates = shuffle(created);
    const linked: { uid: string; patient: NewPatient }[] = [];
    for (let i = active; i < PER_ROLE && candidates.length; i += 1) {
        const patient = candidates.pop() as NewPatient;
        const uid = username(patient.first, patient.last);
        const email = `${uid}@example.org`; // unique because the username is
        await aaa('POST', '/users', {
            token: adminToken,
            body: { username: uid, name: patient.name, email, phone: patient.phone, role: 'patient', password: PASSWORD },
        });
        await execute('UPDATE patients SET account_uid = ?, email = ? WHERE id = ?', [uid, email, patient.id]);
        await mirrorAccount({ uid, name: patient.name, email, role: 'patient', role_name: 'Patient', kind: 'patient' });
        linked.push({ uid, patient });
        bump('accounts: patient (portal)');
    }
    return linked;
}

// ---------------------------------------------------------------------------- 4. sign-ups waiting for approval
async function pendingSignups(adminToken: string) {
    const { data } = await aaa<any[]>('GET', '/signups', { token: adminToken, query: { status: 'pending' } });
    if ((data ?? []).length >= 3) return;
    for (const role of ['psychiatrist', 'therapist', 'nurse'] as const) {
        const gender = chance(0.5) ? 'Female' : 'Male';
        const { first, last } = personName(gender);
        const uid = username(first, last);
        await aaa('POST', '/signup', {
            token: null,
            body: {
                role,
                username: uid,
                name: `${role === 'psychiatrist' ? 'Dr. ' : ''}${first} ${last}`,
                email: `${uid}@${pick(['gmail.com', 'outlook.com', 'yahoo.co.in'])}`,
                phone: phone(),
                password: PASSWORD,
                licence_number: LICENCE[role]?.(),
                justification: pick(['Joining the outpatient team next month', 'Transfer from the city hospital', 'Locum cover for the de-addiction ward', 'New graduate, starting rotation on Ward B']),
            },
        });
        bump('pending sign-ups');
    }
}

// ---------------------------------------------------------------------------- 5. today's activity through the real API
async function caseload(token: string) {
    const result = await api('GET', '/patients', token);
    return (result.body?.data ?? []) as { id: number; mrn: string; full_name: string }[];
}

async function simulateActivity(adminToken: string, roster: Record<string, Person[]>, created: NewPatient[], portal: { uid: string; patient: NewPatient }[]) {
    const sessions: { token: string; person: Person }[] = [];
    const signIn = async (person: Person) => {
        const { token } = await aaaLogin(person.uid, PASSWORD);
        sessions.push({ token, person });
        bump('sign-ins today');
        return token;
    };

    // A few mistyped passwords (stays below the lockout threshold)
    const clinicians = ['psychiatrist', 'psychologist', 'therapist', 'nurse'].flatMap((role) => roster[role] ?? []);
    for (const [person, attempts] of [[pick(clinicians), 1], [pick(clinicians), 3]] as [Person, number][]) {
        for (let n = 0; n < attempts; n += 1) {
            await aaa('POST', '/auth/login', { token: null, body: { identifier: person.uid, password: 'Wrong-pass-1' } }).catch(() => undefined);
            bump('failed sign-ins');
        }
    }

    // Administrator checks the clinic and previews a role
    await aaa('POST', '/auth/act-as', { token: adminToken, body: { role: 'psychiatrist' } });
    await api('GET', '/patients', adminToken);
    await aaa('POST', '/auth/act-as', { token: adminToken, body: { role: null } });

    const byRole = (role: string, count: number) => sample(roster[role] ?? [], count);

    for (const doctor of byRole('psychiatrist', 2)) {
        const token = await signIn(doctor);
        const mine = await caseload(token);
        for (const patient of sample(mine, rand(2, 4))) {
            await api('GET', `/patients/${patient.id}/overview`, token);
            bump('record views');
        }
        for (const patient of sample(mine, 2)) {
            const report = await api('POST', '/reports', token, { patient_id: patient.id, report_type: pick(['clinical-summary', 'medication-review', 'treatment-progress']) });
            if (report.status === 201) bump('reports generated');
        }
    }
    const reader = pick(roster.psychiatrist ?? []);
    if (reader) {
        const token = await signIn(reader);
        const stepUp = await aaaStepUp(token);
        const notes = (await api('GET', '/therapy-notes', token)).body?.data ?? [];
        for (const note of sample(notes as { id: number }[], 2)) {
            await api('GET', `/therapy-notes/${note.id}`, token, undefined, stepUp);
            bump('note decryptions');
        }
    }
    for (const psychologist of byRole('psychologist', 2)) {
        const token = await signIn(psychologist);
        const mine = await caseload(token);
        for (const patient of sample(mine, rand(1, 3))) {
            await api('GET', `/patients/${patient.id}/overview`, token);
            bump('record views');
        }
        const pending = ((await api('GET', '/assessments', token, undefined)).body?.data ?? []).find((a: any) => a.status !== 'completed' && a.status !== 'cancelled');
        if (pending) {
            await api('PUT', `/assessments/${pending.id}`, token, { status: 'completed', score: String(rand(6, 18)), notes: 'Completed in clinic today' });
            bump('assessments recorded');
        }
    }
    const therapists = byRole('therapist', 2);
    for (const [index, therapist] of therapists.entries()) {
        const token = await signIn(therapist);
        const mine = await caseload(token);
        const client = pick(mine);
        if (client) {
            await api('POST', '/sessions', token, { patient_id: client.id, session_type: 'Individual', duration_min: 50, summary: pick(SESSION_SUMMARIES), progress_score: rand(45, 80) });
            bump('sessions logged');
        }
        if (index === 0) {
            // Curiosity about a patient outside the care team is refused and audited
            const outside = created.find((p) => p.lead?.id !== therapist.id && p.extra?.id !== therapist.id);
            if (outside) {
                await api('GET', `/patients/${outside.id}`, token);
                bump('refused access attempts');
            }
        }
    }
    const nurses = byRole('nurse', 2);
    for (const [index, nurse] of nurses.entries()) {
        const token = await signIn(nurse);
        const mine = await caseload(token);
        for (const patient of sample(mine, 2)) {
            await api('POST', '/vitals', token, { patient_id: patient.id, heart_rate: rand(64, 96), bp_systolic: rand(108, 138), bp_diastolic: rand(68, 88), temperature_c: 36.8, spo2: rand(95, 99) });
            bump('vitals recorded today');
        }
        const schedule = (await api('GET', '/medications/schedule', token)).body?.data ?? [];
        // Only chart a dose that is actually due (slot times are ward clock, IST = UTC+5:30)
        const now = new Date(Date.now() + 330 * 60_000);
        const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
        const due = (schedule as any[]).find((slot) => {
            const [hh, mm] = String(slot.scheduled_time).split(':').map(Number);
            return !slot.administration && Math.abs(hh * 60 + mm - nowMinutes) <= 45;
        });
        if (due) {
            await api('POST', `/medications/${due.medication_id}/administer`, token, { scheduled_time: due.scheduled_time, status: 'given' });
            bump('doses given today');
        }
        if (index === 1) {
            // Break-glass: a nurse needs therapy context for a patient outside her care team
            const target = created.find((p) => !p.nurses.some((n) => n.id === nurse.id) && p.lead);
            if (target) {
                const stepUp = await aaaStepUp(token);
                const grant = await api('POST', '/therapy-notes/emergency-access', token, { patient_id: target.id, reason: 'Patient acutely agitated on transfer; need recent therapy context for safe handover.' }, stepUp);
                if (grant.status === 201) {
                    bump('emergency (break-glass) access');
                    const notes = (await api('GET', `/therapy-notes?patient_id=${target.id}`, token)).body?.data ?? [];
                    if (notes[0]) await api('GET', `/therapy-notes/${notes[0].id}`, token, undefined, stepUp);
                }
                const device = await api('POST', '/devices', token, { device_name: `Ward tablet ${rand(2, 9)}`, device_type: 'Tablet', platform: 'Android', justification: 'Shared ward tablet for medication rounds' }, stepUp);
                if (device.status === 201) bump('device requests');
            }
        }
    }

    // Patients use the portal
    for (const { uid } of portal.slice(0, 2)) {
        const { token } = await aaaLogin(uid, PASSWORD);
        bump('sign-ins today');
        await api('GET', '/portal/me', token);
        await api('GET', '/portal/medications', token);
        await api('GET', '/portal/assessments', token);
        const clinicians2 = (await api('GET', '/portal/clinicians', token)).body?.data ?? [];
        for (let tries = 0; tries < 4 && clinicians2.length; tries += 1) {
            const slot = daysAgo(-rand(3, 14));
            const booked = await api('POST', '/portal/appointments', token, { staff_id: pick(clinicians2 as { id: number }[]).id, scheduled_at: slot.toISOString(), appointment_type: 'Follow-up', reason: 'Booked online' });
            if (booked.status === 201) {
                bump('portal bookings');
                break;
            }
        }
        await aaa('POST', '/auth/logout', { token });
    }

    // Forgotten passwords waiting for an administrator
    for (const person of sample(clinicians, 2)) {
        await aaa('POST', '/auth/password-reset/request', { token: null, body: { identifier: person.uid } });
        bump('password reset requests');
    }

    // Most people sign out; a few sessions stay active
    for (const session of sessions.slice(0, Math.max(0, sessions.length - 3))) {
        await aaa('POST', '/auth/logout', { token: session.token }).catch(() => undefined);
    }
}

// ---------------------------------------------------------------------------- main
async function main() {
    console.log(`NeuroLock synthetic data: ${PER_ROLE} accounts per role, ${TARGET_PATIENTS} patients${ACTIVITY ? ', with today\'s activity' : ''}\n`);
    const admin = await aaaLogin(ADMIN_USER, ADMIN_PASSWORD);
    const adminStepUp = await aaaStepUp(admin.token, ADMIN_PASSWORD);
    const listAccounts = async () => (await aaa<Account[]>('GET', '/users', { token: admin.token })).data;

    let accounts = await listAccounts();
    accounts.forEach((account) => usernames.add(account.uid));
    await topUpStaff(admin.token, adminStepUp, accounts);
    accounts = await listAccounts();
    const roster = await loadRoster(accounts);

    // Patients are shared round-robin over every active clinician, including accounts created in the app
    const created = await createPatients(roster);
    for (const [index, patient] of created.entries()) {
        await seedHistory(patient);
        if ((index + 1) % 10 === 0) console.log(`  ... ${index + 1}/${created.length} patients with history`);
    }

    // Ward-wide notices
    if (created.length && roster.nurse?.length) {
        for (const message of ['Fire drill on Ward B today at 15:00', 'Pharmacy: lorazepam stock low, use alternatives where possible']) {
            await execute('INSERT INTO patient_alerts (patient_id, message, priority, category, created_by) VALUES (NULL, ?, ?, ?, ?)', [message, 'medium', 'general', pick(roster.nurse).id]);
            bump('care alerts');
        }
    }

    const portal = await topUpPortalAccounts(admin.token, accounts, created);
    await pendingSignups(admin.token);
    if (ACTIVITY) await simulateActivity(admin.token, roster, created, portal);
    await aaa('POST', '/auth/logout', { token: admin.token }).catch(() => undefined);

    console.log('\nCreated:');
    for (const [key, value] of Object.entries(counts).sort()) console.log(`  ${key.padEnd(34)} ${value}`);
    console.log(`\nAll new accounts use the password ${PASSWORD === 'Demo@1234' ? 'Demo@1234 (the demo password)' : 'given in SEED_PASSWORD'}.`);
    if (portal.length) console.log(`Patient portal logins: ${portal.map((p) => p.uid).join(', ')}`);
}

main()
    .catch((error) => {
        console.error(`\nSynthetic data seeding failed: ${error.message}`);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
