import { Router } from 'express'
import multer from 'multer'
import * as XLSX from 'xlsx'
import { query } from '../db.js'
import { verifyPassword, hashPassword } from '../utils/password.js'
import { signToken, requireAuth, requireRole } from '../middleware/auth.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })

// ---------------------------------------------------------------------------
// POST /api/admin/login
// ---------------------------------------------------------------------------
router.post('/admin/login', async (req, res) => {
  const { username, password } = req.body || {}
  const { rows } = await query('SELECT * FROM users WHERE username = $1 AND role = $2', [username, 'admin'])
  const admin = rows[0]
  if (!admin || !verifyPassword(password, admin.password_hash)) {
    return res.status(401).json({ error: 'Incorrect username or password' })
  }
  const token = signToken({ userId: admin.id, role: 'admin' })
  res.json({ token, adminId: admin.id, name: admin.name })
})

// Everything below this line requires a valid admin token.
router.use(requireAuth, requireRole('admin'))

// ---------------------------------------------------------------------------
// Schools
// ---------------------------------------------------------------------------
router.get('/admin/schools', async (req, res) => {
  const { rows } = await query('SELECT id, name FROM schools ORDER BY name')
  res.json(rows)
})

router.post('/admin/schools', async (req, res) => {
  const { name } = req.body || {}
  if (!name) return res.status(400).json({ error: 'name is required' })
  const { rows } = await query('INSERT INTO schools (name) VALUES ($1) RETURNING id, name', [name])
  res.status(201).json(rows[0])
})

// ---------------------------------------------------------------------------
// Teachers -- admin sets the initial password; a real deployment would
// want a "change password on first login" flow, left as a follow-up.
// ---------------------------------------------------------------------------
router.post('/admin/teachers', async (req, res) => {
  const { name, username, password, schoolId } = req.body || {}
  if (!name || !username || !password || !schoolId) {
    return res.status(400).json({ error: 'name, username, password, and schoolId are all required' })
  }
  try {
    const { rows } = await query(
      `INSERT INTO users (name, role, school_id, username, password_hash)
       VALUES ($1, 'teacher', $2, $3, $4)
       RETURNING id, name, username, school_id AS "schoolId"`,
      [name, schoolId, username, hashPassword(password)]
    )
    res.status(201).json(rows[0])
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That username is already taken' })
    throw err
  }
})

router.get('/admin/teachers', async (req, res) => {
  const { rows } = await query(
    `SELECT u.id, u.name, u.username, s.name AS "schoolName"
     FROM users u JOIN schools s ON s.id = u.school_id
     WHERE u.role = 'teacher' ORDER BY s.name, u.name`
  )
  res.json(rows)
})

// ---------------------------------------------------------------------------
// Student roster upload -- accepts .csv or .xlsx matching the sheet
// columns: School Name, First Name, Last Name, Age, Gender.
// (School Name is used to look up/create the school; every other row
// column is optional beyond First Name / Last Name.)
// ---------------------------------------------------------------------------
router.post('/admin/students/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded (expected field name "file")' })

  let rows
  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    rows = XLSX.utils.sheet_to_json(sheet, { defval: null })
  } catch (err) {
    return res.status(400).json({ error: 'Could not read file. Upload a .csv or .xlsx.' })
  }

  if (rows.length === 0) return res.status(400).json({ error: 'File has no rows' })

  const schoolCache = new Map()
  async function schoolIdFor(name) {
    const key = name.trim().toLowerCase()
    if (schoolCache.has(key)) return schoolCache.get(key)
    const existing = await query('SELECT id FROM schools WHERE lower(name) = $1', [key])
    if (existing.rows[0]) {
      schoolCache.set(key, existing.rows[0].id)
      return existing.rows[0].id
    }
    const created = await query('INSERT INTO schools (name) VALUES ($1) RETURNING id', [name.trim()])
    schoolCache.set(key, created.rows[0].id)
    return created.rows[0].id
  }

  const inserted = []
  const skipped = []

  for (const [i, row] of rows.entries()) {
    const schoolName = row['School Name'] ?? row['school_name'] ?? row['School']
    const firstName = row['First Name'] ?? row['first_name']
    const lastName = row['Last Name'] ?? row['last_name']
    const age = row['Age'] ?? row['age'] ?? null
    const genderRaw = (row['Gender'] ?? row['gender'] ?? '').toString().trim().toUpperCase()
    const gender = ['M', 'F'].includes(genderRaw) ? genderRaw : null

    if (!schoolName || !firstName || !lastName) {
      skipped.push({ row: i + 2, reason: 'Missing School Name, First Name, or Last Name' })
      continue
    }

    const schoolId = await schoolIdFor(String(schoolName))
    const { rows: [student] } = await query(
      `INSERT INTO students (school_id, first_name, last_name, age, gender, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [schoolId, String(firstName).trim(), String(lastName).trim(), age, gender, req.user.userId]
    )
    inserted.push(student.id)
  }

  res.json({ insertedCount: inserted.length, skipped })
})

// ---------------------------------------------------------------------------
// Sync status -- lets the admin see, across all 150+ schools, who has
// actually synced and who's still sitting on data offline.
// ---------------------------------------------------------------------------
router.get('/admin/sync-status', async (req, res) => {
  const { rows } = await query(`
    SELECT
      s.id AS "schoolId",
      s.name AS "schoolName",
      COUNT(DISTINCT st.id) AS "studentCount",
      COUNT(DISTINCT a.uuid) AS "assessmentsReceived",
      MAX(a.received_at) AS "lastSyncAt"
    FROM schools s
    LEFT JOIN students st ON st.school_id = s.id
    LEFT JOIN assessments a ON a.school_id = s.id
    GROUP BY s.id, s.name
    ORDER BY s.name
  `)
  res.json(rows)
})

export default router
