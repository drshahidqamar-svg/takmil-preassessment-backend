-- Adds GPS capture (per assessment) and an optional reference location
-- (per school), needed for the location-based integrity flag: comparing
-- where a submission actually came from against where that school is
-- expected to be.

ALTER TABLE preassessment.assessments
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision,
  ADD COLUMN IF NOT EXISTS location_accuracy_m double precision;

ALTER TABLE preassessment.schools
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision;
