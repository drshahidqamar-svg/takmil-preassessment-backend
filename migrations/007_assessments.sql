-- Curriculum assessments (Primary Levels 1-12 + Grand) taken by the child
-- on a shared tablet. Separate from the pre-assessment and the evaluation.
--
-- assessment_papers: one row per published paper version. The questions
-- live in `items` (jsonb) exactly as the tablet renders them, pictures
-- included as small data URLs, so a downloaded paper works fully offline.
-- A paper is never edited once published: a correction is a new row with
-- a higher version, and attempts keep pointing at the version they used.
--
-- assessment_attempts: one row per child sitting. `answers` holds the raw
-- answers keyed by item id; score, max_score and per-SLO results are
-- recomputed by the server from those answers and the paper (never taken
-- from the tablet).

CREATE TABLE IF NOT EXISTS preassessment.assessment_papers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_key     text NOT NULL,          -- e.g. science-12-grand (stable across versions)
  version       int  NOT NULL DEFAULT 1,
  subject       text NOT NULL,          -- science | urdu | math | english
  level         int  NOT NULL CHECK (level BETWEEN 1 AND 12),
  kind          text NOT NULL CHECK (kind IN ('level', 'grand')),
  title         text NOT NULL,
  language      text NOT NULL DEFAULT 'ur',
  items         jsonb NOT NULL,
  total_marks   numeric NOT NULL,
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
  source_file   text,
  created_by    uuid REFERENCES preassessment.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz,
  UNIQUE (paper_key, version)
);

CREATE TABLE IF NOT EXISTS preassessment.assessment_attempts (
  uuid           uuid PRIMARY KEY,
  paper_id       uuid NOT NULL REFERENCES preassessment.assessment_papers(id),
  student_id     uuid NOT NULL REFERENCES preassessment.students(id),
  teacher_id     uuid NOT NULL REFERENCES preassessment.users(id),
  school_id      uuid NOT NULL REFERENCES preassessment.schools(id),
  answers        jsonb NOT NULL DEFAULT '{}'::jsonb,
  score          numeric,
  max_score      numeric,
  device_id      text,
  started_at     timestamptz,
  completed_at   timestamptz,
  active_seconds int,
  received_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attempts_paper   ON preassessment.assessment_attempts(paper_id);
CREATE INDEX IF NOT EXISTS idx_attempts_school  ON preassessment.assessment_attempts(school_id);
CREATE INDEX IF NOT EXISTS idx_attempts_student ON preassessment.assessment_attempts(student_id);
