-- ============================================================================
-- TAKMIL Pre-Assessment -- initial schema
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS preassessment;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS preassessment.schools (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS preassessment.users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  role           text NOT NULL CHECK (role IN ('admin', 'teacher')),
  school_id      uuid REFERENCES preassessment.schools(id),
  username       text NOT NULL UNIQUE,
  password_hash  text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT teacher_must_have_school
    CHECK (role = 'admin' OR school_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS preassessment.students (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      uuid NOT NULL REFERENCES preassessment.schools(id),
  first_name     text NOT NULL,
  last_name      text NOT NULL,
  date_of_birth  date,
  age            int,
  gender         text CHECK (gender IN ('M', 'F', 'Other')),
  uploaded_by    uuid REFERENCES preassessment.users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_students_school ON preassessment.students(school_id);

CREATE TABLE IF NOT EXISTS preassessment.questions (
  code           text PRIMARY KEY,
  domain         text NOT NULL,
  label          text NOT NULL,
  display_order  int NOT NULL
);

CREATE TABLE IF NOT EXISTS preassessment.assessments (
  uuid           uuid PRIMARY KEY,
  student_id     uuid NOT NULL REFERENCES preassessment.students(id),
  teacher_id     uuid NOT NULL REFERENCES preassessment.users(id),
  school_id      uuid NOT NULL REFERENCES preassessment.schools(id),
  device_id      text,
  started_at     timestamptz,
  completed_at   timestamptz,
  received_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assessments_school ON preassessment.assessments(school_id);
CREATE INDEX IF NOT EXISTS idx_assessments_student ON preassessment.assessments(student_id);

CREATE TABLE IF NOT EXISTS preassessment.responses (
  assessment_uuid  uuid NOT NULL REFERENCES preassessment.assessments(uuid) ON DELETE CASCADE,
  question_code    text NOT NULL REFERENCES preassessment.questions(code),
  answer           text NOT NULL CHECK (answer IN ('yes', 'partial', 'no')),
  answered_at      timestamptz,
  PRIMARY KEY (assessment_uuid, question_code)
);
