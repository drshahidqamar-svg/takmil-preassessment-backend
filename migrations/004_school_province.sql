-- Schools operate across seven administrative regions. Storing this
-- lets the admin dashboard filter/organize by region, and lets the
-- stress test assign geographically realistic test coordinates instead
-- of a single generic Pakistan-wide bounding box.

ALTER TABLE preassessment.schools
  ADD COLUMN IF NOT EXISTS province text;

-- Not a CHECK constraint deliberately -- keeps this easy to extend
-- without a migration if naming conventions shift later. Expected
-- values: Khyber Pakhtunkhwa, Punjab, Sindh, Balochistan, Federal,
-- Azad Jammu & Kashmir, Gilgit-Baltistan.
