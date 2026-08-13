# TAKMIL Pre-Assessment — Backend

Express API + Postgres schema for the pre-assessment app. Everything
lives inside a `preassessment` schema, isolated from your existing LMS
tables in `takmildb`.

## Local setup

```bash
npm install
cp .env.example .env
# edit .env: paste your DATABASE_URL, generate a JWT_SECRET
npm run migrate          # creates the preassessment schema + tables
npm run create-admin -- "Your Name" admin your-chosen-password
npm run dev               # starts on http://localhost:3000
```

Check it's alive: `curl http://localhost:3000/health` → `{"ok":true}`

## API summary

| Endpoint | Who | Purpose |
|---|---|---|
| `POST /api/login` | Teacher | Sign in, get roster + question bank |
| `POST /api/sync` | Teacher (auth) | Upload a batch of completed assessments |
| `POST /api/admin/login` | Admin | Sign in to admin dashboard |
| `POST /api/admin/schools` | Admin | Create a school |
| `POST /api/admin/teachers` | Admin | Create a teacher account (name, username, password, schoolId) |
| `POST /api/admin/students/upload` | Admin | Upload roster as .csv/.xlsx (multipart field `file`) |
| `GET /api/admin/sync-status` | Admin | Per-school student count, assessments received, last sync |

Full request/response shapes are documented as comments in
`src/routes/*.js`.

## Deploying to Railway

Your repo is already connected to Railway, so this is just:

```bash
git add .
git commit -m "Add pre-assessment backend"
git push
```

In the Railway dashboard, set the two environment variables from
`.env.example` (`DATABASE_URL` — Railway auto-fills this if you're using
their Postgres plugin; `JWT_SECRET` — generate your own). Then run the
migration and admin-creation scripts once, either via `railway run` from
your machine or Railway's one-off shell:

```bash
railway run npm run migrate
railway run npm run create-admin -- "Your Name" admin your-chosen-password
```

## Moving to Azure later (takmildb)

Because the schema is plain, portable Postgres with nothing
Railway-specific in it, the move is two commands, not a rewrite:

**1. Recreate the schema on Azure** (safe even if you've already been
running on Railway for a while — the migration runner tracks what's
applied and only runs what's new):

```bash
DATABASE_URL="<azure-connection-string>" npm run migrate
```

**2. Copy the actual data over**, scoped to just this schema so it can't
touch anything else in `takmildb`:

```bash
pg_dump -n preassessment --no-owner --no-privileges "<railway-connection-string>" > preassessment_dump.sql
psql "<azure-connection-string>" < preassessment_dump.sql
```

**3. Point the deployed app at Azure** — update `DATABASE_URL` wherever
you're hosting the API (Railway env var, or wherever you move the app
itself) and redeploy. Nothing in `src/` needs to change.

## Still to build

- Frontend: swap `mockLogin`/`mockPushAssessments` for real calls to this
  API, and add a password field to the teacher login screen (this
  backend expects username + password, not just a name)
- Admin dashboard (a small web app calling the `/api/admin/*` routes above)
- Password reset flow for teachers who forget theirs
