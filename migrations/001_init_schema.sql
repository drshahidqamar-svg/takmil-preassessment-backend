-- ============================================================================
-- TAKMIL Pre-Assessment -- initial schema
-- ============================================================================
-- Everything lives inside its own `preassessment` schema rather than the
-- default `public` schema. This is what makes it safe to live inside the
-- same `takmildb` database as the LMS: table names like `students` or
-- `users` can never collide with LMS tables, and the whole thing can be
-- dropped, dumped, or restored as one unit (`pg_dump -n preassessment`)
-- without touching anything else in the database.
--
-- Nothing in this file is Railway- or Azure-specific -- it's plain
-- standard Postgres, so running it against Railway now and Azure later
-- produces an identical schema either way.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS preassessment;

-- Lets us write `gen_random_uuid()` instead of pulling in a separate
-- uuid library; available by default on both Railway and Azure Postgres.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- schools
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS preassessment.schools (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- users -- both admins and teachers live in one table, distinguished by
-- role. Teachers are scoped to exactly one school; admins are not scoped
-- to any (school_id null).
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- students -- uploaded by an admin, downloaded to a teacher's phone at
-- login. dob and age are both nullable: the admin upload can provide
-- either (age gets computed from dob if given, or stored directly).
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- questions -- the 26-item question bank. Data-driven on purpose: the app
-- fetches this table rather than hardcoding questions, so adding or
-- editing a question later is a database edit, not a redeploy.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS preassessment.questions (
  code           text PRIMARY KEY,
  domain         text NOT NULL,
  label          text NOT NULL,
  display_order  int NOT NULL
);

-- ---------------------------------------------------------------------------
-- assessments -- one row per student per assessment attempt.
--
-- KEY DESIGN DECISION: the primary key (uuid) is generated on the
-- TEACHER'S PHONE at the moment they start the assessment, not by this
-- database. The server never generates it -- it only accepts what the
-- client sends. This is what makes offline sync safe: if a sync request
-- is retried after a dropped connection, `ON CONFLICT (uuid) DO NOTHING`
-- (see sync.js) means it can never create a duplicate record, no matter
-- how many times the same batch gets resent.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- responses -- one row per question answered within an assessment.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS preassessment.responses (
  assessment_uuid  uuid NOT NULL REFERENCES preassessment.assessments(uuid) ON DELETE CASCADE,
  question_code    text NOT NULL REFERENCES preassessment.questions(code),
  answer           text NOT NULL CHECK (answer IN ('yes', 'partial', 'no')),
  answered_at      timestamptz,
  PRIMARY KEY (assessment_uuid, question_code)
);
