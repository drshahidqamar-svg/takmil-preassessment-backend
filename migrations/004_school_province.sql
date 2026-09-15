-- Schools operate across seven administrative regions. Storing this
-- lets the admin dashboard filter/organize by region, and lets the
-- stress test assign geographically realistic test coordinates.

ALTER TABLE preassessment.schools
  ADD COLUMN IF NOT EXISTS province text;
