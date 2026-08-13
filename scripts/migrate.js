// Runs every .sql file in /migrations, in filename order, against
// whatever DATABASE_URL points to. Tracks what's already been applied in
// a small table so re-running is always safe.
//
// This is the whole "move to Azure later" story: point DATABASE_URL at
// the Azure connection string instead of Railway's, run
// `npm run migrate`, and you get an identical `preassessment` schema
// there -- no manual SQL, no drift between environments.
//
// For actually copying the DATA (not just the schema) when you migrate,
// use pg_dump/pg_restore scoped to this schema:
//   pg_dump -n preassessment --no-owner "$RAILWAY_DATABASE_URL" > dump.sql
//   psql "$AZURE_DATABASE_URL" < dump.sql

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Pool } from 'pg'
import 'dotenv/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const migrationsDir = path.join(__dirname, '..', 'migrations')

function sslConfig() {
  // Railway and Azure Postgres both require SSL, but neither presents a
  // certificate chain that Node trusts by default. This keeps the
  // connection encrypted while not fighting cert validation -- the
  // standard pattern for managed Postgres providers.
  if (process.env.PGSSLMODE === 'disable') return false
  return { rejectUnauthorized: false }
}

async function run() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: sslConfig()
  })

  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS preassessment;
    CREATE TABLE IF NOT EXISTS preassessment.schema_migrations (
      filename    text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    );
  `)

  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()
  const { rows: applied } = await pool.query('SELECT filename FROM preassessment.schema_migrations')
  const appliedSet = new Set(applied.map(r => r.filename))

  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`skip  ${file} (already applied)`)
      continue
    }
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
    console.log(`apply ${file}`)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO preassessment.schema_migrations (filename) VALUES ($1)', [file])
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      console.error(`Migration ${file} failed:`, err.message)
      process.exit(1)
    } finally {
      client.release()
    }
  }

  console.log('Migrations up to date.')
  await pool.end()
}

run()
