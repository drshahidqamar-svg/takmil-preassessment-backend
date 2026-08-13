import { Pool } from 'pg'
import 'dotenv/config'

function sslConfig() {
  if (process.env.PGSSLMODE === 'disable') return false
  return { rejectUnauthorized: false }
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslConfig(),
  options: '-c search_path=preassessment,public'
})

export async function query(text, params) {
  return pool.query(text, params)
}
