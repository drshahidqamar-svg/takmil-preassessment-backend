-- Adds the "Section I: Basic Information" fields from the paper
-- assessment form. date_of_birth already existed (migration 001); this
-- adds the rest. All nullable -- a student record can exist from a bulk
-- admin roster upload (which may not have these) before a teacher fills
-- them in during the actual assessment sitting, matching how the paper
-- form works (Section I filled in by the teacher alongside the test).

ALTER TABLE preassessment.students
  ADD COLUMN IF NOT EXISTS father_name text,
  ADD COLUMN IF NOT EXISTS mother_tongue text,
  ADD COLUMN IF NOT EXISTS disability text,          -- free text, matches the paper's blank line (not a fixed category list)
  ADD COLUMN IF NOT EXISTS reason_out_of_school text,
  ADD COLUMN IF NOT EXISTS religion text,
  ADD COLUMN IF NOT EXISTS village_place text,
  ADD COLUMN IF NOT EXISTS date_of_joining date;
