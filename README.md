# TAKMIL Pre-Assessment — Backend

Express API + Postgres schema for the pre-assessment app.

## Local setup

```bash
npm install
cp .env.example .env
npm run migrate
npm run create-admin -- "Your Name" admin your-chosen-password
npm run dev
```

## Bulk upload endpoints (new)

**POST /api/admin/schools/upload** — multipart field `file`, .csv/.xlsx with columns:
`School Name`, `Province` (optional). Skips names that already exist.

**POST /api/admin/teachers/upload** — multipart field `file`, .csv/.xlsx with columns:
`Teacher Name`, `Username`, `School Name`, `Password` (optional — auto-generated if blank).
Response includes `created: [{ name, username, password, schoolName, passwordWasGenerated }]`
with plaintext passwords for the admin to copy out immediately — this is the only place
this API ever returns a plaintext password, and it's never stored anywhere (only its
bcrypt hash is saved).

## Deploying to Railway

```bash
git add .
git commit -m "..."
git push
```

Auto-deploys via the existing GitHub connection. Run `npm run migrate` against
production once after any schema change (via `railway run` or a one-off shell).

## Evaluation Assessment (ASER 2018 tool)

A separate test from the pre-assessment, stored in its own table
(`migrations/006_evaluations.sql`). Run `npm run migrate` against production
**before** deploying this code -- the admin endpoints reference the new table.

- Content: `src/aser/aser2018.json` (4 samples; English/Urdu reading, Math).
  The same file ships inside the teacher app; keep both copies identical.
  When the booklet changes, add a new file with a new `version` rather than
  editing the old one -- phones may sync weeks later with the old version.
- Scoring: `src/aser/aserScoring.js` (also shared with the app). The server
  recomputes every level from the raw per-item marks; it never trusts a level
  sent by the phone.
- Levels: reading 0 Beginner, 1 Letter, 2 Word, 3 Sentence, 4 Paragraph,
  5 Story; math 0 Beginner, 1 2-digit, 2 3-digit, 3 Subtraction, 4 Multiplication.
- A student may be evaluated more than once (each sitting is its own row);
  retries of the same sitting are idempotent by the phone-generated uuid.

Endpoints:

| Method | Path | Who |
|---|---|---|
| POST | `/api/evaluations/sync` | teacher |
| GET | `/api/admin/evaluations` | admin |
| GET | `/api/admin/evaluations/levels` | admin |
| GET | `/api/admin/evaluations/:uuid` (per-item detail) | admin |
| GET | `/api/admin/evaluations-export?token=...` (Excel) | admin |

Integrity flags for evaluations: too fast (< 2 min), no location, far from
the school's usual location. The answer-pattern checks are off for this test,
since a strong reader legitimately gets every item right.
