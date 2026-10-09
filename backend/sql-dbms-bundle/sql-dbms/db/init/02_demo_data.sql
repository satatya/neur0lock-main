-- Demo clinical data so every dashboard has something to show.
-- Dates are relative to the day the database is initialised.
-- (Encrypted therapy notes are seeded by `npm run db:setup`, because they need the KEK.)
USE neurolock;

SET @psychiatrist = (SELECT id FROM staff WHERE email = 'psychiatrist@neurolock.com');
SET @psychologist = (SELECT id FROM staff WHERE email = 'psychologist@neurolock.com');
SET @therapist    = (SELECT id FROM staff WHERE email = 'therapist@neurolock.com');
SET @nurse        = (SELECT id FROM staff WHERE email = 'nurse@neurolock.com');
SET @admin        = (SELECT id FROM staff WHERE email = 'admin@neurolock.com');

INSERT INTO patients (mrn, full_name, dob, gender, phone, email, address, emergency_contact_name, emergency_contact_phone,
                      insurance, allergies, primary_diagnosis, secondary_diagnosis, ward, room, status, priority,
                      attending_physician_id, assigned_therapist_id, admission_date, created_by) VALUES
  ('MRN001', 'Riya Jain', '1996-05-17', 'Female', '+91-90000-11111', 'riya@example.org', '12 Lake Road, Pune',
   'Amit Jain (Brother)', '+91-90000-11112', 'Star Health Gold', 'Penicillin',
   'Major Depressive Disorder', 'Generalized Anxiety Disorder', 'Ward A', 'A-101', 'active', 'high',
   @psychiatrist, @therapist, DATE_SUB(UTC_DATE(), INTERVAL 21 DAY), @admin),
  ('MRN002', 'Arjun Mehta', '1988-11-02', 'Male', '+91-90000-22221', 'arjun@example.org', '4 MG Road, Bengaluru',
   'Kavya Mehta (Spouse)', '+91-90000-22222', 'HDFC Ergo', NULL,
   'Bipolar I Disorder', NULL, 'Ward B', 'B-204', 'active', 'medium',
   @psychiatrist, NULL, DATE_SUB(UTC_DATE(), INTERVAL 9 DAY), @admin),
  ('MRN003', 'Sara Thomas', '2001-02-14', 'Female', '+91-90000-33331', 'sara@example.org', '88 Park Street, Kolkata',
   'Mary Thomas (Mother)', '+91-90000-33332', 'ICICI Lombard', 'Latex',
   'Post-Traumatic Stress Disorder', 'Insomnia', NULL, NULL, 'active', 'medium',
   @psychiatrist, @therapist, NULL, @admin),
  ('MRN004', 'Vikram Nair', '1975-07-30', 'Male', '+91-90000-44441', NULL, '21 Beach Road, Kochi',
   'Lakshmi Nair (Sister)', '+91-90000-44442', 'Government scheme', 'Sulfa drugs',
   'Schizophrenia', NULL, 'Ward C', 'C-310', 'critical', 'high',
   @psychiatrist, NULL, DATE_SUB(UTC_DATE(), INTERVAL 30 DAY), @admin),
  ('MRN005', 'Meera Iyer', '1993-09-09', 'Female', '+91-90000-55551', 'meera@example.org', '7 Temple Street, Chennai',
   'Ravi Iyer (Father)', '+91-90000-55552', 'Star Health', NULL,
   'Obsessive-Compulsive Disorder', NULL, NULL, NULL, 'active', 'low',
   @psychiatrist, @psychologist, NULL, @admin),
  ('MRN006', 'Daniel Fernandes', '1983-03-21', 'Male', '+91-90000-66661', 'daniel@example.org', '3 Church Lane, Goa',
   'Anita Fernandes (Wife)', '+91-90000-66662', 'Bajaj Allianz', NULL,
   'Alcohol Use Disorder', 'Major Depressive Disorder', 'Ward B', 'B-210', 'active', 'medium',
   @psychiatrist, @therapist, DATE_SUB(UTC_DATE(), INTERVAL 5 DAY), @admin);

-- Riya Jain also has a patient-portal account (demo login: patient / Demo@1234)
UPDATE patients SET account_uid = 'patient', email = 'patient@neurolock.com' WHERE mrn = 'MRN001';

SET @riya   = (SELECT id FROM patients WHERE mrn = 'MRN001');
SET @arjun  = (SELECT id FROM patients WHERE mrn = 'MRN002');
SET @sara   = (SELECT id FROM patients WHERE mrn = 'MRN003');
SET @vikram = (SELECT id FROM patients WHERE mrn = 'MRN004');
SET @meera  = (SELECT id FROM patients WHERE mrn = 'MRN005');
SET @daniel = (SELECT id FROM patients WHERE mrn = 'MRN006');

-- Medications ---------------------------------------------------------------
INSERT INTO medications (patient_id, name, dose, frequency, route, scheduled_times, instructions, start_date, status, prescribed_by) VALUES
  (@riya,   'Sertraline',         '50mg',   'Once daily',  'Oral', '08:00',       'Take with breakfast',          DATE_SUB(UTC_DATE(), INTERVAL 20 DAY), 'active', @psychiatrist),
  (@riya,   'Lorazepam',          '1mg',    'At night',    'Oral', '21:00',       'Hold if drowsy',               DATE_SUB(UTC_DATE(), INTERVAL 20 DAY), 'active', @psychiatrist),
  (@arjun,  'Lithium Carbonate',  '300mg',  'Twice daily', 'Oral', '08:00,20:00', 'Check serum lithium weekly',   DATE_SUB(UTC_DATE(), INTERVAL 9 DAY),  'active', @psychiatrist),
  (@vikram, 'Risperidone',        '2mg',    'Twice daily', 'Oral', '09:00,21:00', NULL,                           DATE_SUB(UTC_DATE(), INTERVAL 30 DAY), 'active', @psychiatrist),
  (@meera,  'Fluoxetine',         '20mg',   'Once daily',  'Oral', '08:00',       NULL,                           DATE_SUB(UTC_DATE(), INTERVAL 60 DAY), 'active', @psychiatrist),
  (@daniel, 'Naltrexone',         '50mg',   'Once daily',  'Oral', '10:00',       NULL,                           DATE_SUB(UTC_DATE(), INTERVAL 5 DAY),  'active', @psychiatrist),
  (@daniel, 'Thiamine',           '100mg',  'Once daily',  'Oral', '10:00',       NULL,                           DATE_SUB(UTC_DATE(), INTERVAL 5 DAY),  'active', @psychiatrist);

INSERT INTO medication_administrations (medication_id, patient_id, schedule_date, scheduled_time, administered_by, administered_at, status, notes)
SELECT id, patient_id, UTC_DATE(), '08:00', @nurse, UTC_TIMESTAMP(), 'given', NULL
FROM medications WHERE patient_id IN (@riya, @arjun) AND scheduled_times LIKE '08:00%';

-- Appointments --------------------------------------------------------------
INSERT INTO appointments (patient_id, staff_id, scheduled_at, duration_min, appointment_type, reason, status, created_by) VALUES
  (@riya,   @psychiatrist, DATE_ADD(TIMESTAMP(UTC_DATE()), INTERVAL 28 HOUR),  30, 'Medication review', 'Sertraline dose review',          'scheduled', @psychiatrist),
  (@arjun,  @psychiatrist, DATE_ADD(TIMESTAMP(UTC_DATE()), INTERVAL 10 HOUR),  30, 'Follow-up',         'Mood stabiliser follow-up',       'scheduled', @psychiatrist),
  (@sara,   @therapist,    DATE_ADD(TIMESTAMP(UTC_DATE()), INTERVAL 53 HOUR),  50, 'Therapy session',   'Trauma-focused CBT',              'scheduled', @therapist),
  (@meera,  @psychologist, DATE_ADD(TIMESTAMP(UTC_DATE()), INTERVAL 76 HOUR),  60, 'Assessment',        'Y-BOCS assessment',               'scheduled', @psychologist),
  (@daniel, @therapist,    DATE_ADD(TIMESTAMP(UTC_DATE()), INTERVAL 30 HOUR),  50, 'Therapy session',   'Relapse prevention',              'scheduled', @therapist),
  (@riya,   @therapist,    DATE_SUB(TIMESTAMP(UTC_DATE()), INTERVAL 66 HOUR),  50, 'Therapy session',   'CBT session',                     'completed', @therapist);

-- Therapy sessions & progress ----------------------------------------------
INSERT INTO therapy_sessions (patient_id, clinician_id, session_date, duration_min, session_type, summary, progress_score) VALUES
  (@riya,   @therapist,    DATE_SUB(UTC_DATE(), INTERVAL 17 DAY), 50, 'Individual', 'Intake and rapport building; mapped core stressors', 55),
  (@riya,   @therapist,    DATE_SUB(UTC_DATE(), INTERVAL 10 DAY), 50, 'Individual', 'Behavioural activation plan agreed',                 62),
  (@riya,   @therapist,    DATE_SUB(UTC_DATE(), INTERVAL 3 DAY),  50, 'Individual', 'Good progress on anxiety management techniques',     70),
  (@sara,   @therapist,    DATE_SUB(UTC_DATE(), INTERVAL 12 DAY), 60, 'Individual', 'Psychoeducation on trauma responses',               40),
  (@sara,   @therapist,    DATE_SUB(UTC_DATE(), INTERVAL 5 DAY),  60, 'Group',      'Participated actively in group discussion',          48),
  (@daniel, @therapist,    DATE_SUB(UTC_DATE(), INTERVAL 2 DAY),  45, 'Individual', 'Motivational interviewing; identified triggers',     30),
  (@meera,  @psychologist, DATE_SUB(UTC_DATE(), INTERVAL 14 DAY), 60, 'Individual', 'ERP hierarchy constructed',                          45),
  (@meera,  @psychologist, DATE_SUB(UTC_DATE(), INTERVAL 7 DAY),  60, 'Individual', 'First exposure tasks completed',                     52);

INSERT INTO patient_progress (patient_id, score, note, recorded_by, recorded_at)
SELECT patient_id, progress_score, summary, clinician_id, TIMESTAMP(session_date)
FROM therapy_sessions WHERE progress_score IS NOT NULL;

-- Vitals --------------------------------------------------------------------
INSERT INTO vitals (patient_id, recorded_by, recorded_at, heart_rate, bp_systolic, bp_diastolic, temperature_c, respiratory_rate, spo2) VALUES
  (@riya,   @nurse, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 26 HOUR), 76, 118, 78, 36.8, 16, 98),
  (@riya,   @nurse, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 HOUR),  72, 120, 80, 36.9, 15, 99),
  (@arjun,  @nurse, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 3 HOUR),  68, 118, 76, 36.7, 14, 98),
  (@vikram, @nurse, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR),  88, 134, 88, 37.4, 18, 96),
  (@daniel, @nurse, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 4 HOUR),  92, 138, 90, 37.1, 17, 97);

-- Patient care alerts -------------------------------------------------------
INSERT INTO patient_alerts (patient_id, message, priority, category, created_by) VALUES
  (@arjun,  'Serum lithium level check due today',         'high',   'lab',        @psychiatrist),
  (@vikram, 'Refused evening Risperidone dose yesterday',  'high',   'medication', @nurse),
  (@riya,   'Scheduled vitals check this afternoon',       'medium', 'vitals',     @nurse),
  (@meera,  'Review recent lab results',                   'low',    'lab',        @psychiatrist);

-- Assessments ---------------------------------------------------------------
INSERT INTO assessments (patient_id, assessment_type, scheduled_by, scheduled_by_id, status, scheduled_date, score, notes) VALUES
  (@riya,  'Beck Depression Inventory', 'psychologist@neurolock.com', @psychologist, 'completed', DATE_SUB(UTC_DATE(), INTERVAL 10 DAY), '24', 'Moderate depression; re-assess in 4 weeks'),
  (@riya,  'GAD-7',                     'psychologist@neurolock.com', @psychologist, 'scheduled', DATE_ADD(UTC_DATE(), INTERVAL 5 DAY),  NULL, 'Anxiety follow-up'),
  (@sara,  'PCL-5',                     'psychologist@neurolock.com', @psychologist, 'pending',   DATE_ADD(UTC_DATE(), INTERVAL 2 DAY),  NULL, NULL),
  (@meera, 'Y-BOCS',                    'psychologist@neurolock.com', @psychologist, 'scheduled', DATE_ADD(UTC_DATE(), INTERVAL 3 DAY),  NULL, 'Baseline severity');
