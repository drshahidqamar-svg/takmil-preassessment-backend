// Run once after migrating, to create the first admin account.
// Usage:  node scripts/create-admin.js "Program Admin" admin yourpassword

import { pool } from '../src/db.js'
import { hashPassword } from '../src/utils/password.js'
import 'dotenv/config'

const [name, username, password] = process.argv.slice(2)

if (!name || !username || !password) {
  console.error('Usage: node scripts/create-admin.js "Full Name" username password')
  process.exit(1)
}

const { rows } = await pool.query(
  `INSERT INTO users (name, role, username, password_hash)
   VALUES ($1, 'admin', $2, $3)
   ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash
   RETURNING id, name, username`,
  [name, username, hashPassword(password)]
)

console.log('Admin account ready:', rows[0])
await pool.end()
