-- Adds the "Section I: Basic Information" fields from the paper
-- assessment form. date_of_birth already existed (migration 001); this
-- adds the rest. All nullable.

ALTER TABLE preassessment.students
  ADD COLUMN IF NOT EXISTS father_name text,
  ADD COLUMN IF NOT EXISTS mother_tongue text,
  ADD COLUMN IF NOT EXISTS disability text,
  ADD COLUMN IF NOT EXISTS reason_out_of_school text,
  ADD COLUMN IF NOT EXISTS religion text,
  ADD COLUMN IF NOT EXISTS village_place text,
  ADD COLUMN IF NOT EXISTS date_of_joining date;
