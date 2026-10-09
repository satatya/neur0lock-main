-- Directory mirror rows for the demo accounts, so the demo clinical data below can reference them.
-- The accounts themselves (passwords, roles, permissions) are created in OpenLDAP by the AAA
-- server on first start. Demo password for every account: Demo@1234
USE neurolock;

INSERT INTO staff (uid, email, name, role, role_name, kind) VALUES
  ('admin',        'admin@neurolock.com',        'Admin User',     'admin',        'Administrator',          'staff'),
  ('psychiatrist', 'psychiatrist@neurolock.com', 'Dr. Jane Smith', 'psychiatrist', 'Psychiatrist (Doctor)',  'staff'),
  ('psychologist', 'psychologist@neurolock.com', 'Dr. Priya Rao',  'psychologist', 'Psychologist',           'staff'),
  ('therapist',    'therapist@neurolock.com',    'John Therapist', 'therapist',    'Therapist',              'staff'),
  ('nurse',        'nurse@neurolock.com',        'Sarah Nurse',    'nurse',        'Nurse',                  'staff'),
  ('patient',      'patient@neurolock.com',      'Riya Jain',      'patient',      'Patient',                'patient');
