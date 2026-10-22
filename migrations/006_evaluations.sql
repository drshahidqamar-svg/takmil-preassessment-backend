-- Evaluation Assessment (ASER 2018-style tool), a SEPARATE test from the
-- pre-assessment. Kept in its own table so the pre-assessment tables --
-- and the one-assessment-per-student lock on them -- are untouched.
--
-- Unlike the pre-assessment, a student may be evaluated more than once
-- (e.g. mid-year and end of year), so there is no per-student lock here.
-- Each row is one sitting. Retries of the same sitting are still safe:
-- the phone generates the uuid, and sync inserts with ON CONFLICT DO NOTHING.
--
-- responses holds the raw per-item marks exactly as the teacher tapped
-- them: { english: { steps: [{ level, variant, marks: [1,0,null,...] }] },
-- urdu: {...}, math: {...} }. The three *_level columns are recomputed by
-- the server from those marks on every sync (never trusted from the
-- phone) and stored so the dashboard can filter/aggregate cheaply.
--   reading levels: 0 Beginner, 1 Letter, 2 Word, 3 Sentence, 4 Para, 5 Story
--   math levels:    0 Beginner, 1 2-digit, 2 3-digit, 3 Subtraction, 4 Multiplication

CREATE TABLE IF NOT EXISTS preassessment.evaluations (
  uuid                 uuid PRIMARY KEY,
  student_id           uuid NOT NULL REFERENCES preassessment.students(id),
  teacher_id           uuid NOT NULL REFERENCES preassessment.users(id),
  school_id            uuid NOT NULL REFERENCES preassessment.schools(id),
  tool_version         text NOT NULL,
  sample_no            int  NOT NULL CHECK (sample_no BETWEEN 1 AND 4),
  english_level        int  CHECK (english_level BETWEEN 0 AND 5),
  urdu_level           int  CHECK (urdu_level BETWEEN 0 AND 5),
  math_level           int  CHECK (math_level BETWEEN 0 AND 4),
  responses            jsonb NOT NULL DEFAULT '{}'::jsonb,
  device_id            text,
  started_at           timestamptz,
  completed_at         timestamptz,
  latitude             double precision,
  longitude            double precision,
  location_accuracy_m  double precision,
  received_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evaluations_school  ON preassessment.evaluations(school_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_student ON preassessment.evaluations(student_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_teacher ON preassessment.evaluations(teacher_id);
