import { Router } from 'express'
import multer from 'multer'
import * as XLSX from 'xlsx'
import { query } from '../db.js'
import { verifyPassword, hashPassword } from '../utils/password.js'
import { signToken, requireAuth, requireRole } from '../middleware/auth.js'
import { buildScores } from '../utils/scoring.js'
import { computeIntegrityFlags, FLAG_LABELS } from '../utils/integrity.js'

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
  const { rows } = await query('SELECT id, name, province FROM schools ORDER BY name')
  res.json(rows)
})

router.post('/admin/schools', async (req, res) => {
  const { name, province } = req.body || {}
  if (!name) return res.status(400).json({ error: 'name is required' })
  const { rows } = await query(
    'INSERT INTO schools (name, province) VALUES ($1, $2) RETURNING id, name, province',
    [name, province || null]
  )
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

    // Optional "Section I" fields -- most rosters won't have these yet
    // (they're normally collected by the teacher during the assessment
    // itself), but a school with existing digital enrollment records can
    // supply them here instead of re-asking in the field.
    const fatherName = row['Father Name'] ?? row['father_name'] ?? null
    const motherTongue = row['Mother Tongue'] ?? row['mother_tongue'] ?? null
    const disability = row['Disability'] ?? row['disability'] ?? null
    const reasonOutOfSchool = row['Reason Out of School'] ?? row['reason_out_of_school'] ?? null
    const religion = row['Religion'] ?? row['religion'] ?? null
    const villagePlace = row['Village/Place'] ?? row['village_place'] ?? null

    if (!schoolName || !firstName || !lastName) {
      skipped.push({ row: i + 2, reason: 'Missing School Name, First Name, or Last Name' })
      continue
    }

    const schoolId = await schoolIdFor(String(schoolName))
    const { rows: [student] } = await query(
      `INSERT INTO students
         (school_id, first_name, last_name, age, gender, uploaded_by,
          father_name, mother_tongue, disability, reason_out_of_school, religion, village_place)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        schoolId, String(firstName).trim(), String(lastName).trim(), age, gender, req.user.userId,
        fatherName, motherTongue, disability, reasonOutOfSchool, religion, villagePlace
      ]
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

// ---------------------------------------------------------------------------
// Results -- one row per student assessment with every question's answer,
// per-subject scores, and an overall score. Powers the admin dashboard's
// Results page and its Excel export.
// ---------------------------------------------------------------------------
async function fetchResultRows() {
  const { rows } = await query(`
    SELECT
      a.uuid AS assessment_uuid,
      a.teacher_id, a.school_id,
      s.name AS school_name, s.province AS school_province,
      u.name AS teacher_name,
      st.first_name, st.last_name, st.age, st.gender,
      st.father_name, st.mother_tongue, st.disability, st.reason_out_of_school, st.religion, st.village_place,
      a.started_at, a.completed_at,
      a.latitude, a.longitude, a.location_accuracy_m,
      r.question_code, q.domain, r.answer
    FROM assessments a
    JOIN students st ON st.id = a.student_id
    JOIN schools s ON s.id = a.school_id
    JOIN users u ON u.id = a.teacher_id
    LEFT JOIN responses r ON r.assessment_uuid = a.uuid
    LEFT JOIN questions q ON q.code = r.question_code
    ORDER BY s.name, st.last_name, st.first_name
  `)

  // Group the flat SQL rows (one per question answer) back into one
  // record per assessment, then compute scores for each.
  const byAssessment = new Map()
  for (const row of rows) {
    if (!byAssessment.has(row.assessment_uuid)) {
      byAssessment.set(row.assessment_uuid, {
        uuid: row.assessment_uuid,
        teacherId: row.teacher_id,
        schoolId: row.school_id,
        schoolName: row.school_name,
        schoolProvince: row.school_province,
        teacherName: row.teacher_name,
        firstName: row.first_name,
        lastName: row.last_name,
        age: row.age,
        gender: row.gender,
        fatherName: row.father_name,
        motherTongue: row.mother_tongue,
        disability: row.disability,
        reasonOutOfSchool: row.reason_out_of_school,
        religion: row.religion,
        villagePlace: row.village_place,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        latitude: row.latitude,
        longitude: row.longitude,
        locationAccuracyM: row.location_accuracy_m,
        responseRows: []
      })
    }
    byAssessment.get(row.assessment_uuid).responseRows.push({
      domain: row.domain, questionCode: row.question_code, answer: row.answer
    })
  }

  const results = [...byAssessment.values()].map(a => {
    const { domainScores, overallScore, answers } = buildScores(a.responseRows)
    return { ...a, domainScores, overallScore, answers }
  })

  const { rows: schools } = await query('SELECT id, latitude, longitude FROM schools')
  const flagsByUuid = computeIntegrityFlags(results, schools)
  return results.map(r => ({ ...r, flags: flagsByUuid.get(r.uuid) || [] }))
}

// GET /api/admin/results -- JSON, for the dashboard table
router.get('/admin/results', async (req, res) => {
  const results = await fetchResultRows()
  res.json(results.map(({ responseRows, teacherId, schoolId, ...rest }) => rest))
})

// GET /api/admin/results/export -- full-detail Excel workbook
router.get('/admin/results/export', async (req, res) => {
  const results = await fetchResultRows()
  const { rows: questions } = await query('SELECT code, domain, label, display_order FROM questions ORDER BY display_order')
  const domains = [...new Set(questions.map(q => q.domain))]

  // Sheet 1: every student, every question's answer, every domain score
  const detailRows = results.map(r => {
    const row = {
      'School': r.schoolName,
      'Province': r.schoolProvince || '',
      'Teacher': r.teacherName,
      'First Name': r.firstName,
      'Last Name': r.lastName,
      'Age': r.age,
      'Gender': r.gender,
      'Father Name': r.fatherName || '',
      'Mother Tongue': r.motherTongue || '',
      'Disability': r.disability || '',
      'Reason Out of School': r.reasonOutOfSchool || '',
      'Religion': r.religion || '',
      'Village/Place': r.villagePlace || ''
    }
    for (const q of questions) row[q.code] = r.answers[q.code] || ''
    for (const d of domains) row[`${d} Score (%)`] = r.domainScores[d] ?? ''
    row['Overall Score (%)'] = r.overallScore
    row['Started At'] = r.startedAt ? new Date(r.startedAt).toLocaleString() : ''
    row['Submitted At'] = r.completedAt ? new Date(r.completedAt).toLocaleString() : ''
    row['Duration (min)'] = (r.startedAt && r.completedAt)
      ? Math.round(((new Date(r.completedAt) - new Date(r.startedAt)) / 60000) * 10) / 10
      : ''
    row['GPS Latitude'] = r.latitude ?? ''
    row['GPS Longitude'] = r.longitude ?? ''
    row['Review Flags'] = r.flags.map(f => FLAG_LABELS[f] || f).join('; ')
    return row
  })

  // Sheet 2: per-school aggregate
  const bySchool = {}
  for (const r of results) {
    bySchool[r.schoolName] = bySchool[r.schoolName] || { school: r.schoolName, scores: [] }
    bySchool[r.schoolName].scores.push(r.overallScore)
  }
  const schoolSummaryRows = Object.values(bySchool).map(s => ({
    'School': s.school,
    'Students Assessed': s.scores.length,
    'Average Overall Score (%)': Math.round((s.scores.reduce((a, b) => a + b, 0) / s.scores.length) * 10) / 10
  }))

  // Sheet 3: by gender
  const byGender = {}
  for (const r of results) {
    const g = r.gender || 'Unspecified'
    byGender[g] = byGender[g] || []
    byGender[g].push(r.overallScore)
  }
  const genderRows = Object.entries(byGender).map(([gender, scores]) => ({
    'Gender': gender === 'F' ? 'Girls' : gender === 'M' ? 'Boys' : gender,
    'Students Assessed': scores.length,
    'Average Overall Score (%)': Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
  }))

  // Sheet 4: by age
  const byAge = {}
  for (const r of results) {
    const age = r.age ?? 'Unspecified'
    byAge[age] = byAge[age] || []
    byAge[age].push(r.overallScore)
  }
  const ageRows = Object.entries(byAge)
    .sort(([a], [b]) => (a === 'Unspecified' ? 1 : b === 'Unspecified' ? -1 : Number(a) - Number(b)))
    .map(([age, scores]) => ({
      'Age': age,
      'Students Assessed': scores.length,
      'Average Overall Score (%)': Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
    }))

  // Sheet 5: flagged submissions only -- the actual review worklist
  const flaggedRows = results
    .filter(r => r.flags.length > 0)
    .map(r => ({
      'School': r.schoolName,
      'Teacher': r.teacherName,
      'Student': `${r.firstName} ${r.lastName}`,
      'Submitted At': r.completedAt ? new Date(r.completedAt).toLocaleString() : '',
      'Reasons Flagged': r.flags.map(f => FLAG_LABELS[f] || f).join('; ')
    }))

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(detailRows), 'Student Results')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(schoolSummaryRows), 'By School')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(genderRows), 'By Gender')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(ageRows), 'By Age')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(flaggedRows), 'Flagged for Review')

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="takmil-preassessment-results.xlsx"')
  res.send(buffer)
})

export default router
