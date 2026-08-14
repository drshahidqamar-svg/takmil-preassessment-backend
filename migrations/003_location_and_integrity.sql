-- Adds GPS capture (per assessment) and an optional reference location
-- (per school), needed for the location-based integrity flag: comparing
-- where a submission actually came from against where that school is
-- expected to be.

ALTER TABLE preassessment.assessments
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision,
  ADD COLUMN IF NOT EXISTS location_accuracy_m double precision;

-- Optional -- an admin can set a school's known coordinates directly for
-- an exact reference point. If left blank, the system falls back to
-- inferring the school's location from the median of its own past
-- submissions once enough exist (see backend/src/utils/integrity.js).
ALTER TABLE preassessment.schools
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision;
