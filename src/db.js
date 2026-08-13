import { Pool } from 'pg'
import 'dotenv/config'

function sslConfig() {
  if (process.env.PGSSLMODE === 'disable') return false
  return { rejectUnauthorized: false }
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslConfig(),
  // Sets search_path as part of the connection's own startup handshake,
  // rather than firing a separate SET query after connecting. The
  // previous approach (a query in a pool 'connect' listener) wasn't
  // guaranteed to finish before the connection was handed back for use --
  // harmless under light load, but a real race under concurrent requests.
  // This way it's baked into the connection itself.
  options: '-c search_path=preassessment,public'
})

export async function query(text, params) {
  return pool.query(text, params)
}
