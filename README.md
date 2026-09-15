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
