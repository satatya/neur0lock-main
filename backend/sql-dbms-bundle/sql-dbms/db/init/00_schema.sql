-- NeuroLock schema (MySQL 8.x)
-- Applied automatically by the MySQL container on first start (docker-entrypoint-initdb.d),
-- or by `npm run db:setup` in neurolock-staff-backend. Clinical data only: authentication,
-- authorization and accounting are handled by the AAA server (see aaa-server/).
CREATE DATABASE IF NOT EXISTS neurolock CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE neurolock;

-- ---------------------------------------------------------------------------
-- Directory mirror
-- Identities, passwords, roles and permissions live in the AAA server (OpenLDAP).
-- This table only gives clinical records a stable numeric id to reference; the
-- REST API keeps it in sync with the directory. It holds no credentials.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS staff (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  uid VARCHAR(64) NOT NULL UNIQUE,                -- directory username (LDAP uid)
  email VARCHAR(120) NULL,
  name VARCHAR(200) NOT NULL,
  role VARCHAR(40) NULL,                          -- directory role at last sync, e.g. 'therapist'
  role_name VARCHAR(80) NULL,
  kind ENUM('staff', 'patient') NOT NULL DEFAULT 'staff',
  synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_staff_kind (kind, role)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Clinical data
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patients (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  mrn VARCHAR(32) NOT NULL UNIQUE,
  account_uid VARCHAR(64) NULL UNIQUE,            -- patient portal account (directory uid), if any
  full_name VARCHAR(200) NOT NULL,
  dob DATE NULL,
  gender VARCHAR(20) NULL,
  phone VARCHAR(30) NULL,
  email VARCHAR(120) NULL,
  address VARCHAR(255) NULL,
  emergency_contact_name VARCHAR(120) NULL,
  emergency_contact_phone VARCHAR(30) NULL,
  insurance VARCHAR(120) NULL,
  allergies VARCHAR(255) NULL,
  primary_diagnosis VARCHAR(200) NULL,
  secondary_diagnosis VARCHAR(200) NULL,
  ward VARCHAR(40) NULL,
  room VARCHAR(20) NULL,
  status ENUM('active', 'inactive', 'critical', 'discharged') NOT NULL DEFAULT 'active',
  priority ENUM('low', 'medium', 'high') NOT NULL DEFAULT 'medium',
  attending_physician_id BIGINT UNSIGNED NULL,
  assigned_therapist_id BIGINT UNSIGNED NULL,
  admission_date DATE NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_patient_physician FOREIGN KEY (attending_physician_id) REFERENCES staff(id) ON DELETE SET NULL,
  CONSTRAINT fk_patient_therapist FOREIGN KEY (assigned_therapist_id) REFERENCES staff(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Care team: staff who may see a patient besides the attending physician and assigned therapist
-- (any role, e.g. a ward nurse or a second psychologist). Clinicians without the
-- patients:read_all permission only see patients they are on the care team of.
CREATE TABLE IF NOT EXISTS patient_care_team (
  patient_id BIGINT UNSIGNED NOT NULL,
  staff_id BIGINT UNSIGNED NOT NULL,
  reason VARCHAR(20) NOT NULL DEFAULT 'assigned',  -- assigned | created | appointment | booking
  added_by BIGINT UNSIGNED NULL,
  added_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (patient_id, staff_id),
  INDEX idx_care_team_staff (staff_id),
  CONSTRAINT fk_care_team_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
  CONSTRAINT fk_care_team_staff FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Encrypted therapy notes (envelope encryption per record: AES-256-GCM data key wrapped by the KEK)
CREATE TABLE IF NOT EXISTS therapy_notes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  patient_id BIGINT UNSIGNED NOT NULL,
  author_id BIGINT UNSIGNED NULL,
  author VARCHAR(120) NOT NULL,
  note_type VARCHAR(40) NOT NULL DEFAULT 'Session Note',
  session_date DATE NULL,
  version INT NOT NULL DEFAULT 1,
  aad_bound TINYINT(1) NOT NULL DEFAULT 0,        -- 1 = ciphertext is bound to the patient id (AES-GCM AAD)
  dek_wrapped VARBINARY(64) NOT NULL,             -- RFC 3394 key-wrap output (KEK-wrapped DEK)
  iv VARBINARY(12) NOT NULL,                      -- 96-bit nonce for AES-GCM
  ciphertext LONGBLOB NOT NULL,                   -- AES-GCM ciphertext (includes tag)
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by BIGINT UNSIGNED NULL,
  INDEX idx_notes_patient (patient_id),
  CONSTRAINT fk_notes_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
  CONSTRAINT fk_notes_author FOREIGN KEY (author_id) REFERENCES staff(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS therapy_note_versions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  note_id BIGINT UNSIGNED NOT NULL,
  version INT NOT NULL,
  aad_bound TINYINT(1) NOT NULL DEFAULT 0,
  dek_wrapped VARBINARY(64) NOT NULL,
  iv VARBINARY(12) NOT NULL,
  ciphertext LONGBLOB NOT NULL,
  edited_by BIGINT UNSIGNED NULL,
  edited_by_name VARCHAR(200) NULL,
  change_summary VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_versions_note (note_id),
  CONSTRAINT fk_versions_note FOREIGN KEY (note_id) REFERENCES therapy_notes(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Break-glass access to therapy notes (always audited as critical)
CREATE TABLE IF NOT EXISTS emergency_access (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  staff_id BIGINT UNSIGNED NOT NULL,
  patient_id BIGINT UNSIGNED NOT NULL,
  reason TEXT NOT NULL,
  granted_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  INDEX idx_emergency_lookup (staff_id, patient_id, expires_at),
  CONSTRAINT fk_emergency_staff FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE,
  CONSTRAINT fk_emergency_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS medications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  patient_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(200) NOT NULL,
  dose VARCHAR(100) NULL,
  frequency VARCHAR(100) NULL,
  route VARCHAR(50) NULL,
  scheduled_times VARCHAR(100) NULL,              -- comma-separated HH:MM administration slots
  instructions VARCHAR(255) NULL,
  start_date DATE NULL,
  end_date DATE NULL,
  status ENUM('active', 'on_hold', 'discontinued') NOT NULL DEFAULT 'active',
  prescribed_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_meds_patient (patient_id),
  CONSTRAINT fk_med_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
  CONSTRAINT fk_med_prescriber FOREIGN KEY (prescribed_by) REFERENCES staff(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS medication_administrations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  medication_id BIGINT UNSIGNED NOT NULL,
  patient_id BIGINT UNSIGNED NOT NULL,
  schedule_date DATE NULL,                        -- the (ward-local) day of the dose slot
  scheduled_time CHAR(5) NULL,                    -- HH:MM slot the dose belongs to
  administered_by BIGINT UNSIGNED NULL,
  administered_at DATETIME NOT NULL,
  status ENUM('given', 'refused', 'held', 'missed') NOT NULL DEFAULT 'given',
  notes VARCHAR(255) NULL,
  INDEX idx_admin_med (medication_id, administered_at),
  CONSTRAINT fk_admin_med FOREIGN KEY (medication_id) REFERENCES medications(id) ON DELETE CASCADE,
  CONSTRAINT fk_admin_staff FOREIGN KEY (administered_by) REFERENCES staff(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS assessments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  patient_id BIGINT UNSIGNED NOT NULL,
  assessment_type VARCHAR(255) NOT NULL,
  scheduled_by VARCHAR(255) NOT NULL,
  scheduled_by_id BIGINT UNSIGNED NULL,
  status ENUM('scheduled', 'pending', 'completed', 'cancelled') NOT NULL DEFAULT 'scheduled',
  scheduled_date DATE NULL,
  score VARCHAR(50) NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_assess_patient (patient_id),
  CONSTRAINT fk_assess_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
  CONSTRAINT fk_assess_staff FOREIGN KEY (scheduled_by_id) REFERENCES staff(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS appointments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  patient_id BIGINT UNSIGNED NOT NULL,
  staff_id BIGINT UNSIGNED NULL,                  -- clinician the appointment is with
  scheduled_at DATETIME NOT NULL,                 -- UTC
  duration_min INT NOT NULL DEFAULT 50,
  appointment_type VARCHAR(40) NOT NULL DEFAULT 'Consultation',
  reason VARCHAR(255) NULL,
  status ENUM('scheduled', 'completed', 'cancelled', 'no_show') NOT NULL DEFAULT 'scheduled',
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_appt_patient (patient_id),
  INDEX idx_appt_time (scheduled_at),
  CONSTRAINT fk_appt_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
  CONSTRAINT fk_appt_staff FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS therapy_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  patient_id BIGINT UNSIGNED NOT NULL,
  clinician_id BIGINT UNSIGNED NULL,
  session_date DATE NOT NULL,
  duration_min INT NOT NULL DEFAULT 50,
  session_type VARCHAR(40) NOT NULL DEFAULT 'Individual',
  summary VARCHAR(500) NULL,
  progress_score TINYINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sessions_patient (patient_id),
  CONSTRAINT fk_tsession_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
  CONSTRAINT fk_tsession_staff FOREIGN KEY (clinician_id) REFERENCES staff(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS patient_progress (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  patient_id BIGINT UNSIGNED NOT NULL,
  score TINYINT UNSIGNED NOT NULL,
  note VARCHAR(255) NULL,
  recorded_by BIGINT UNSIGNED NULL,
  recorded_at DATETIME NOT NULL,
  INDEX idx_progress_patient (patient_id, recorded_at),
  CONSTRAINT fk_progress_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
  CONSTRAINT fk_progress_staff FOREIGN KEY (recorded_by) REFERENCES staff(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS vitals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  patient_id BIGINT UNSIGNED NOT NULL,
  recorded_by BIGINT UNSIGNED NULL,
  recorded_at DATETIME NOT NULL,
  heart_rate SMALLINT UNSIGNED NULL,
  bp_systolic SMALLINT UNSIGNED NULL,
  bp_diastolic SMALLINT UNSIGNED NULL,
  temperature_c DECIMAL(4,1) NULL,
  respiratory_rate SMALLINT UNSIGNED NULL,
  spo2 TINYINT UNSIGNED NULL,
  notes VARCHAR(255) NULL,
  INDEX idx_vitals_patient (patient_id, recorded_at),
  CONSTRAINT fk_vitals_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
  CONSTRAINT fk_vitals_staff FOREIGN KEY (recorded_by) REFERENCES staff(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS patient_alerts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  patient_id BIGINT UNSIGNED NULL,
  message VARCHAR(255) NOT NULL,
  priority ENUM('low', 'medium', 'high') NOT NULL DEFAULT 'medium',
  category VARCHAR(40) NOT NULL DEFAULT 'general',
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  acknowledged_by BIGINT UNSIGNED NULL,
  acknowledged_at DATETIME NULL,
  INDEX idx_alerts_open (acknowledged_at),
  CONSTRAINT fk_alert_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
  CONSTRAINT fk_alert_staff FOREIGN KEY (created_by) REFERENCES staff(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS reports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  patient_id BIGINT UNSIGNED NOT NULL,
  report_type VARCHAR(40) NOT NULL,
  generated_by BIGINT UNSIGNED NULL,
  generated_by_name VARCHAR(200) NULL,
  content JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_reports_patient (patient_id),
  CONSTRAINT fk_report_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
  CONSTRAINT fk_report_staff FOREIGN KEY (generated_by) REFERENCES staff(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Accounting (audit trail) is kept by the AAA server and forwarded to the rsyslog log server.
