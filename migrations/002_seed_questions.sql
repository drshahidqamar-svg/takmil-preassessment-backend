-- Seeds the question bank exactly as given in the original assessment
-- sheet. Safe to re-run: ON CONFLICT means re-running migrations never
-- duplicates rows.

INSERT INTO preassessment.questions (code, domain, label, display_order) VALUES
  ('LLLQ1', 'Local Language Literacy',      'Can Identify Alphabets',   1),
  ('LLLQ2', 'Local Language Literacy',      'Can Read',                 2),
  ('LLLQ3', 'Local Language Literacy',      'Can Write Alphabets',      3),
  ('LLLQ4', 'Local Language Literacy',      'Can Make a Sentence',      4),

  ('ELLQ1', 'English Language Literacy',    'Can Identify Alphabets',   5),
  ('ELLQ2', 'English Language Literacy',    'Can Read',                 6),
  ('ELLQ3', 'English Language Literacy',    'Can Write Alphabets',      7),
  ('ELLQ4', 'English Language Literacy',    'Can Make a Sentence',      8),

  ('ULLQ1', 'Urdu Language Literacy',       'Can Make a Sentence',      9),
  ('ULLQ2', 'Urdu Language Literacy',       'Can Read',                 10),
  ('ULLQ3', 'Urdu Language Literacy',       'Can Write Alphabets',      11),
  ('ULLQ4', 'Urdu Language Literacy',       'Can Identify Alphabets',   12),

  ('NumQ1', 'Numeracy',                     'Can Identify Numbers',     13),
  ('NumQ2', 'Numeracy',                     'Can Identify Number Value',14),
  ('NumQ3', 'Numeracy',                     'Can Perform Addition',     15),
  ('NumQ4', 'Numeracy',                     'Can Perform Subtraction',  16),
  ('NumQ5', 'Numeracy',                     'Can Identify Shapes',      17),

  ('SDSQ1', 'Social & Development Skills',  'Can Tell Name',            18),
  ('SDSQ2', 'Social & Development Skills',  'Can Tell Parents'' Name',  19),
  ('SDSQ3', 'Social & Development Skills',  'Can Tell Age',             20),
  ('SDSQ4', 'Social & Development Skills',  'Can Tell Time',            21),
  ('SDSQ5', 'Social & Development Skills',  'Can Tell Address',         22),
  ('SDSQ6', 'Social & Development Skills',  'Aware of Hygiene',         23),
  ('SDSQ7', 'Social & Development Skills',  'Can Identify Money',       24),
  ('SDSQ8', 'Social & Development Skills',  'Can Identify Feelings',    25),
  ('SDSQ9', 'Social & Development Skills',  'Can Communicate',          26)
ON CONFLICT (code) DO UPDATE SET
  domain = EXCLUDED.domain,
  label = EXCLUDED.label,
  display_order = EXCLUDED.display_order;
